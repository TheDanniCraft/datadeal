import type { ScanReport } from "@datadeal/contracts";
import { acceptAllHomepage } from "@datadeal/contracts/content-page";
import { c15tChoiceDisclosure } from "@datadeal/contracts/c15t-choice";
import { googleCookieDeclarations } from "@datadeal/contracts/google-cookies";
import { metaCookieDisclosure } from "@datadeal/contracts/meta-cookies";
import { publicPolicyHighlights } from "./policy-highlights";
import { visitorPractice } from "./visitor-practice";
import { measuredPracticeFacts } from "./content-pages";
import { googleAnalyticsVisit } from "./google-analytics-visit";

type Source = { source: string; label: string; quote?: string };
export type VisitorClaim = { text: string; sources: Source[] };
const words = new Intl.ListFormat("en");

export { acceptAllHomepage };

function namedStorageClaims(
  report: ScanReport,
  measured: NonNullable<ReturnType<typeof acceptAllHomepage>>,
) {
  const homepage = measured.source.id;
  const rows = new Map(
    report.evidence
      .filter((row) => row.scanId === report.id)
      .map((row) => [row.id, row]),
  );
  const facts = measuredPracticeFacts(report).filter(
    (fact) =>
      fact.page === "homepage" &&
      fact.scenario === "accepted" &&
      fact.storage?.presentAt?.includes("end") &&
      fact.evidenceIds.includes(homepage),
  );
  const declarations = facts
    .flatMap((fact) => googleCookieDeclarations(fact, rows))
    .filter((d) => d.supportsPublicClaim);
  const claims: VisitorClaim[] = [];
  const meta = facts
    .map((fact) => metaCookieDisclosure(fact, rows))
    .filter((d) => d !== undefined);
  if (meta.length) {
    const source = meta[0]!.source;
    const names = [
      ...new Set(
        meta.filter((d) => d.source.id === source.id).map((d) => d.family),
      ),
    ].sort();
    // Both declarations can occur in the same paragraph. Open that paragraph
    // rather than offering two links to the same document.
    claims.push({
      text:
        `After accepting all on the homepage, the browser held ${words.format(names)}. ` +
        (names.includes("datr")
          ? `Meta describes datr as a unique browser identifier used to help prevent fraud${names.includes("sb") ? " and sb as a way to recognize your browser securely" : ""}.`
          : "Meta says sb lets it recognize your browser securely."),
      sources: [
        { source: homepage, label: "Homepage cookies after accepting all" },
        {
          source: source.id,
          label: "Meta’s cookie security policy",
          quote: names.length === 1 ? meta[0]!.text : source.excerpt,
        },
      ],
    });
  }
  let consentClaim: VisitorClaim | undefined;
  for (const family of ["NID", "SOCS", "AEC"] as const) {
    const match = declarations.find((d) => d.family === family);
    if (!match) continue;
    const purpose = {
      NID: "can be used to show ads to signed-out visitors",
      SOCS: "remembers your cookie choices",
      AEC: "helps detect spam, fraud and abuse",
    }[family];
    const policy = {
      source: match.source.id,
      label: `How Google describes ${family}`,
      quote: match.text,
    };
    if (family === "AEC" && consentClaim) {
      consentClaim.text =
        "The browser also held SOCS and AEC. Google says SOCS remembers your cookie choices and AEC helps detect spam, fraud and abuse.";
      consentClaim.sources.push(policy);
      continue;
    }
    const claim = {
      text: `${claims.length ? "The browser also held" : "After accepting all on the homepage, the browser held"} Google’s ${family} cookie, which Google says ${purpose}.`,
      sources: [
        { source: homepage, label: "Homepage cookies after accepting all" },
        policy,
      ],
    };
    claims.push(claim);
    if (family === "SOCS") consentClaim = claim;
  }
  // Response hosts cover the entire visit. An empty after-choice host list
  // locates the corresponding requests before acceptance, not their replies.
  const { afterChoice, responseDomains = [], externalDomains } = measured.visit;
  if (
    claims.length &&
    afterChoice?.requests &&
    !afterChoice.externalDomains.length &&
    afterChoice.requests < measured.visit.requests &&
    responseDomains.length > 0 &&
    responseDomains.length <= 2 &&
    responseDomains.every((host) => externalDomains.includes(host))
  ) {
    claims.push({
      text: `The browser contacted ${words.format(responseDomains)} before you accepted. No further requests to outside domains appeared during this visit.`,
      sources: [
        { source: homepage, label: "Requests before and after accepting" },
      ],
    });
  }
  return claims;
}

function storageClaim(
  report: ScanReport,
  measured: NonNullable<ReturnType<typeof acceptAllHomepage>>,
): VisitorClaim | undefined {
  const { source, visit } = measured;
  const end = visit.storageSummary?.end;
  const local = visit.storage?.localEntries ?? end?.web?.local.total;
  const session = visit.storage?.sessionEntries ?? end?.web?.session.total;
  const sources: Source[] = [
    { source: source.id, label: "Homepage storage after accepting all" },
  ];
  const held = [
    [visit.cookies, "one cookie", "cookies"],
    [local, "one item in local storage", "items in local storage"],
    [session, "one item in session storage", "items in session storage"],
  ] as const;
  const items = held.flatMap(([n, singular, plural]) =>
    n ? [n === 1 ? singular : `${n} ${plural}`] : [],
  );
  if (!items.length) {
    if (local !== 0 || session !== 0) return;
    return {
      text: "After accepting all on the homepage, the browser held no cookies or web storage at the end of the visit.",
      sources,
    };
  }
  let text = `After accepting all, the homepage visit ended with ${words.format(items)}.`;
  const cookies = end?.cookies.recognized ?? [];
  const signals = cookies.filter((c) =>
    ["_fbp", "_fbc", "_gcl_au"].includes(c.name),
  );
  const facts = new Map(
    measuredPracticeFacts(report)
      .filter(
        (f) =>
          f.page === "homepage" &&
          f.scenario === "accepted" &&
          f.storage?.snapshot === "end" &&
          !f.request,
      )
      .map((f) => [f.factId, f]),
  );
  const citations = new Map(
    report.evidence.filter((e) => e.scanId === report.id).map((e) => [e.id, e]),
  );
  const preference = [...facts.values()]
    .map((f) => c15tChoiceDisclosure(f, citations))
    .find(Boolean);
  if (
    preference &&
    visit.cookies === 1 &&
    local === 1 &&
    session === 0 &&
    end?.cookies.total === 1 &&
    end.cookies.inspected === 1 &&
    end.web?.local.total === 1 &&
    end.web.local.inspected === 1 &&
    end.web.session.total === 0
  ) {
    return {
      text: "After you accept all on the homepage, one cookie and one local storage entry remember your privacy choices.",
      sources: [
        ...sources,
        {
          source: preference.id,
          label: "How the site remembers your choice",
          quote: preference.excerpt,
        },
      ],
    };
  }
  const supported = (report.dataPractices ?? []).filter(
    (p) =>
      facts.has(p.factId) &&
      p.interpretation === "analyst_reviewed" &&
      p.confidence !== "low" &&
      p.necessity === "proportionate" &&
      p.evidence.context.length &&
      p.evidence.context.every((id) =>
        report.evidence.some(
          (e) =>
            e.id === id &&
            e.scanId === report.id &&
            e.kind === "declared_first_party",
        ),
      ),
  );
  const purposes = new Set<string>();
  const verifiedItems = new Set<string>();
  for (const p of supported) {
    const meaning = {
      support: "keeping a support conversation together",
      consent: "remembering a consent choice",
      security: "a security check",
    }[p.purpose as "support" | "consent" | "security"];
    if (!meaning) continue;
    const meta = facts.get(p.factId)!.storage!;
    const key = JSON.stringify([meta.mechanism, meta.family, meta.site]);
    if (
      verifiedItems.has(key) ||
      sources.length + p.evidence.context.length > 16
    )
      continue;
    verifiedItems.add(key);
    purposes.add(meaning);
    for (const id of p.evidence.context)
      if (!sources.some((s) => s.source === id))
        sources.push({ source: id, label: "Documented cookie purpose" });
  }
  const explanations: string[] = [];
  if (purposes.size)
    explanations.push("the documented uses include " + words.format(purposes));
  if (signals.length)
    explanations.push(
      (signals.length === 1
        ? "one cookie matched"
        : signals.length + " cookies matched") +
        " a known advertising pattern (" +
        [...new Set(signals.map((c) => c.name))].join(", ") +
        ")",
    );
  if (explanations.length) {
    const sentence = words.format(explanations);
    text += " " + sentence[0].toUpperCase() + sentence.slice(1) + ".";
  } else if (
    !cookies.length &&
    end?.web &&
    [end.web.local, end.web.session].every((s) =>
      s.categories.every((c) => c === "unclassified"),
    )
  ) {
    text = text.slice(0, -1) + ", of unknown purpose.";
  }
  return { text, sources };
}

export function visitorSummary(report?: ScanReport) {
  const claims: VisitorClaim[] = [];
  if (!report) return { claims };
  const noChoice = (report.scoringCorrection?.result ?? report.scoring)
    ?.noChoiceEvidence;
  if (noChoice) {
    claims.push(
      {
        text: `On the ${noChoice.visitIds.length} signed-out pages tested, the browser saw no outside requests or consent prompt and ended each visit with no cookies or web storage.`,
        sources: noChoice.visitIds.map((source, i) => ({
          source,
          label: i ? `Sampled page ${i}` : "Homepage visit",
        })),
      },
      {
        text: "The privacy policy says the site uses no cookies and collects no personal data from visitors.",
        sources: [
          {
            source: noChoice.policyId,
            label: "Visitor privacy policy",
            quote: noChoice.quote,
          },
        ],
      },
    );
  }
  const measured = acceptAllHomepage(report);
  const impact = measured && visitorPractice(report, "accepted");
  if (impact) {
    claims.push({ text: impact.summary, sources: impact.sources });
    if (impact.policy) claims.push(impact.policy);
  }
  const analytics = googleAnalyticsVisit(report);
  if (analytics && claims.length < 3) {
    const { text, ...source } = analytics;
    claims.push({ text, sources: [source] });
  }
  if (measured && !analytics) {
    const named = namedStorageClaims(report, measured);
    if (named.length) claims.push(...named.slice(0, 3 - claims.length));
    else {
      const storage = storageClaim(report, measured);
      if (storage) claims.push(storage);
    }
  }
  for (const item of publicPolicyHighlights(report)) {
    if (
      claims.length >= 3 ||
      (impact?.policy && item.title === "Advertising and tracking") ||
      claims.some((claim) =>
        claim.sources.some((source) => source.source === item.source),
      )
    )
      continue;
    const row = report.evidence.find(
      (s) =>
        s.scanId === report.id &&
        s.id === item.source &&
        s.kind === "declared_first_party",
    );
    if (!row) continue;
    const text =
      /\bpolicy\b|\bnotice\b|^[\p{Lu}][\p{L}\d.'’ &-]{0,70} (?:says|states|explains|discloses)\b/iu.test(
        item.text,
      )
        ? item.text
        : "According to the policy, " +
          item.text.replace(
            /^(If|When|Your|You|The|This|After|Before|Personal|Information|Account|Collected|Data|Contact|Device|Usage)\b/,
            (w) => w.toLowerCase(),
          );
    claims.push({
      text,
      sources: [
        {
          source: item.source,
          label: item.title ?? "Privacy policy",
          quote: item.quote,
        },
      ],
    });
  }
  return { claims, factId: impact?.factId };
}
