import { requestEvidencePriority } from "@datadeal/contracts";
import type { ScanReport } from "@datadeal/contracts";

/**
 * The parts of a browser request the collector reads. Playwright's Request
 * fits; the extension adapts webRequest events to the same shape.
 */
export type Request = {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postDataBuffer(): {
    length: number;
    toString(encoding: "utf8"): string;
  } | null;
  frame(): { url(): string; parentFrame(): unknown };
};
import { parse } from "tldts";
import type { IsolatedIdentifierMatcher } from "./identifier-match";

type Observed = NonNullable<ScanReport["evidence"][number]["observation"]>;
type Network = Extract<Observed, { type: "browser_request_fields" }>;
type Field = Network["fieldCategories"][number];
type Source = Network["sources"][number];
const bodyLimit = 24_576;
const fieldBudget = 128;
const names = new Map<string, Field>([
  ["email", "email"],
  ["email_address", "email"],
  ["emailaddress", "email"],
  ["phone", "phone"],
  ["phone_number", "phone"],
  ["telephone", "phone"],
  ["client_id", "identifier"],
  ["visitor_id", "identifier"],
  ["user_id", "identifier"],
  ["session_id", "identifier"],
  ["device_id", "identifier"],
  ["gclid", "advertising_id"],
  ["fbclid", "advertising_id"],
  ["advertising_id", "advertising_id"],
  ["adid", "advertising_id"],
  ["utm_source", "campaign"],
  ["utm_medium", "campaign"],
  ["utm_campaign", "campaign"],
  ["utm_term", "campaign"],
  ["utm_content", "campaign"],
  ["page_url", "page_url"],
  ["page_location", "page_url"],
  ["referrer", "referrer_url"],
  ["referer", "referrer_url"],
  ["document_referrer", "referrer_url"],
  ["event_name", "event_name"],
  ["screen_width", "screen_size"],
  ["screen_height", "screen_size"],
  ["screen_resolution", "screen_size"],
  ["language", "language"],
  ["locale", "language"],
]);

const address =
  /^[a-z0-9!#$%&'*+=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function containsAddress(value: string) {
  if (!value.includes("@")) return false;
  // Test whole tokens. A URL path or credentials in a URL are not an email field.
  return value
    .split(/[\s,;<>"()]+/u)
    .some(
      (token) =>
        token.length <= 255 && address.test(token.replace(/[.!]$/, "")),
    );
}

function site(hostname: string) {
  const result = parse(hostname, { allowPrivateDomains: true });
  return result.isIcann || result.isPrivate ? result.domain : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The Events API names the event "name" and the pseudonymous visitor "user_id".
// Match both on the same record at the vendor endpoint. Other Permutive routes
// also take identifiers and cannot establish that a behavioral event was sent.
function permutiveEvent(target: URL, payload: unknown) {
  if (target.origin !== "https://api.permutive.app") return;
  const eventMatches = (event: unknown) =>
    record(event) &&
    typeof event.name === "string" &&
    event.name.length <= 200 &&
    event.name.trim().length > 0 &&
    record(event.properties) &&
    typeof event.user_id === "string" &&
    /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(event.user_id);
  const rows =
    target.pathname === "/v2.0/events"
      ? [payload]
      : target.pathname === "/v2.0/batch/events" && Array.isArray(payload)
        ? payload
        : [];
  const event = rows.find(eventMatches);
  if (record(event) && typeof event.user_id === "string") return event.user_id;
}

function requestInitiator(
  request: Request,
  homepage: URL,
): Network["initiator"] {
  try {
    const frame = request.frame();
    if (new URL(frame.url()).origin !== homepage.origin)
      return frame.parentFrame() ? "outside_frame" : "unknown";
    return frame.parentFrame() ? "same_origin_frame" : "tested_top_level";
  } catch {
    return "unknown";
  }
}

function plausiblePayload(
  payload: Record<string, unknown>,
  homepageSite: string | null,
) {
  const compact =
    Object.hasOwn(payload, "n") &&
    Object.hasOwn(payload, "u") &&
    Object.hasOwn(payload, "d");
  const name = compact ? payload.n : payload.name;
  const url = compact ? payload.u : payload.url;
  const domain = compact ? payload.d : payload.domain;
  if (
    !homepageSite ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 200 ||
    typeof url !== "string" ||
    typeof domain !== "string"
  )
    return false;
  if (!URL.canParse(url) || !/^[a-z0-9.-]+$/i.test(domain)) return false;
  const page = new URL(url);
  return (
    /^https?:$/.test(page.protocol) &&
    site(page.hostname) === homepageSite &&
    site(domain) === homepageSite
  );
}

function classify(
  request: Request,
  homepage: URL,
  homeSite: string | null,
  phase: Network["phase"],
  markLimited: () => void,
  captureEvent: (value: string) => void,
  matcher?: IsolatedIdentifierMatcher,
): Omit<Network, "attempts" | "responses"> | undefined {
  // Do not parse unbounded URLs, binary attachments, or multipart uploads.
  const rawUrl = request.url();
  if (rawUrl.length > 16_384) {
    markLimited();
    return;
  }
  const target = new URL(rawUrl);
  const targetDomain = site(target.hostname);
  if (!homeSite || !targetDomain) return;
  const fields = new Set<Field>();
  const sources = new Set<Source>();
  let signature: Network["signature"];
  let matchedStorage: Network["matchedStorage"];
  const initiator = requestInitiator(request, homepage);
  let remaining = fieldBudget;
  function add(field: Field, source: Source) {
    fields.add(field);
    sources.add(source);
  }
  function visit(key: string, value: unknown, source: Source, depth = 0) {
    if (--remaining < 0 || depth > 5) {
      markLimited();
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [child, entry] of Object.entries(value)) {
        if (remaining <= 0) {
          markLimited();
          break;
        }
        visit(child, entry, source, depth + 1);
      }
    } else {
      if (
        typeof value !== "number" &&
        (typeof value !== "string" || !value.trim())
      )
        return;
      const field = names.get(key.toLowerCase());
      if (field) add(field, source);
      if (typeof value === "string" && containsAddress(value))
        add("email_value", source);
      if (
        field === "email" &&
        typeof value === "string" &&
        value.length <= 255 &&
        address.test(value.trim())
      )
        add("email_address_value", source);
    }
  }
  for (const [key, value] of target.searchParams) {
    if (remaining <= 0) {
      markLimited();
      break;
    }
    visit(key, value, "query");
  }
  const method = request.method();
  const browserId = target.searchParams.get("fbp");
  if (
    method === "GET" &&
    target.origin === "https://www.facebook.com" &&
    /^\/tr\/?$/.test(target.pathname) &&
    /^\d{5,24}$/.test(target.searchParams.get("id") ?? "") &&
    /^[A-Za-z][A-Za-z0-9_ ]{0,99}$/.test(target.searchParams.get("ev") ?? "") &&
    browserId &&
    /^fb\.\d{1,2}\.\d{13}\.\d{1,20}$/.test(browserId)
  ) {
    signature = "meta_pixel_event";
    add("advertising_id", "query");
    add("event_name", "query");
    if (matcher && initiator === "tested_top_level") captureEvent(browserId);
    if (
      initiator === "tested_top_level" &&
      matcher?.match("fbp_cookie", browserId)
    )
      matchedStorage = "fbp_cookie";
  }
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    remaining = fieldBudget;
    const headers = request.headers();
    const media = (headers["content-type"] ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const json = media === "application/json" || media.endsWith("+json");
    if (
      json ||
      media === "application/x-www-form-urlencoded" ||
      media === "text/plain"
    ) {
      const tooLarge = Number(headers["content-length"]) > bodyLimit;
      const body = tooLarge ? null : request.postDataBuffer();
      if (tooLarge || (body && body.length > bodyLimit)) markLimited();
      if (body && body.length <= bodyLimit) {
        const text = body.toString("utf8").trim();
        if (media === "application/x-www-form-urlencoded") {
          for (const [key, value] of new URLSearchParams(text)) {
            if (remaining <= 0) {
              markLimited();
              break;
            }
            visit(key, value, "form");
          }
        } else if (json || /^[{\[]/.test(text)) {
          try {
            const payload: unknown = JSON.parse(text);
            visit("", payload, "json");
            const visitorId =
              method === "POST" && permutiveEvent(target, payload);
            if (visitorId) {
              signature = "permutive_event";
              if (initiator === "tested_top_level") {
                if (matcher) captureEvent(visitorId);
                if (matcher?.match("permutive_cookie", visitorId))
                  matchedStorage = "permutive_cookie";
                else if (matcher?.match("permutive_local", visitorId))
                  matchedStorage = "permutive_local";
              }
              add("identifier", "json");
              add("event_name", "json");
            }
            if (
              method === "POST" &&
              record(payload) &&
              /\/api\/event\/?$/.test(target.pathname) &&
              plausiblePayload(payload, homeSite)
            ) {
              signature = "plausible_event";
              for (const field of [
                "site_domain",
                "page_url",
                "event_name",
              ] as const)
                add(field, "json");
              if (typeof payload.r === "string" && payload.r.trim())
                add("referrer_url", "json");
              if (typeof payload.w === "number" && payload.w > 0)
                add("screen_size", "json");
              if (record(payload.props) && Object.keys(payload.props).length)
                add("custom_properties", "json");
            }
          } catch {
            /* Malformed payloads supply no structured evidence. */
          }
        } else if (containsAddress(text)) add("email_value", "text");
      }
    }
  }
  if (!fields.size) return;
  const sameSite =
    target.protocol === homepage.protocol && targetDomain === homeSite;
  return {
    type: "browser_request_fields",
    targetDomain,
    scheme: target.protocol === "https:" ? "https" : "http",
    relation:
      target.origin === homepage.origin
        ? "same_origin"
        : sameSite
          ? "same_site"
          : "cross_site",
    method: method === "GET" || method === "POST" ? method : "OTHER",
    phase,
    fieldCategories: [...fields].sort(),
    sources: [...sources].sort(),
    ...(signature && { signature }),
    initiator,
    ...(matchedStorage && { matchedStorage }),
  };
}

export function requestFieldCollector(
  homepage: URL,
  matcher?: IsolatedIdentifierMatcher,
) {
  const homeSite = site(homepage.hostname);
  const groups = new Map<string, Network>();
  const examinedByPhase = { before_choice: 0, after_choice: 0 };
  const observed = new WeakMap<Request, Network>();
  const pendingEvent = new WeakMap<Request, string>();
  const answeredEvents = new Map<Network, Set<string>>();
  const inspection = { examined: 0, matched: 0, limitReached: false };
  const markLimited = () => {
    inspection.limitReached = true;
  };
  return {
    request(request: Request, phase: Network["phase"]) {
      if (!/^https?:\/\//i.test(request.url())) return;
      if (examinedByPhase[phase] >= 512) {
        markLimited();
        return;
      }
      examinedByPhase[phase]++;
      inspection.examined++;
      const shape = classify(
        request,
        homepage,
        homeSite,
        phase,
        markLimited,
        (value) => {
          const hash = matcher?.eventDigest(value);
          if (hash) pendingEvent.set(request, hash);
        },
        matcher,
      );
      if (!shape) return;
      inspection.matched++;
      const key = JSON.stringify(shape);
      let group = groups.get(key);
      if (!group) {
        if (groups.size >= 24) markLimited();
        group = { ...shape, attempts: 0, responses: 0 };
        groups.set(key, group);
      }
      group.attempts++;
      observed.set(request, group);
    },
    response(request: Request) {
      const group = observed.get(request);
      if (group) {
        group.responses++;
        const hash = pendingEvent.get(request);
        if (hash && !group.matchedStorage) {
          const digests = answeredEvents.get(group) ?? new Set<string>();
          if (digests.size < 8) digests.add(hash);
          else if (!digests.has(hash)) markLimited();
          answeredEvents.set(group, digests);
          pendingEvent.delete(request);
        }
        observed.delete(request);
      }
    },
    results() {
      for (const [group, digests] of answeredEvents) {
        if (
          group.signature !== "meta_pixel_event" &&
          group.signature !== "permutive_event"
        )
          continue;
        for (const digest of digests) {
          const marker = matcher?.endMatch(digest, group.signature);
          if (marker) {
            group.matchedEndStorage = marker;
            break;
          }
        }
      }
      const measured = [...groups.values()];
      if (measured.length <= 24) return measured;
      return measured
        .sort((a, b) => requestEvidencePriority(b) - requestEvidencePriority(a))
        .slice(0, 24);
    },
    inspection: () => ({ ...inspection }),
  };
}
