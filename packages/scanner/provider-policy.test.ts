import { expect, it, vi } from "vitest";
import { evidence } from "@datadeal/contracts";
import { load } from "cheerio";
import { extractPolicySections } from "./observations";
import {
  providerPolicyEvidence,
  type ProviderPolicyReference,
} from "./provider-policy";

const scanId = "11000000-0000-4000-8000-000000000001";
const note =
  "We use a booking service provided by Calendar. It may process booking details you submit.";
const ref: ProviderPolicyReference = {
  url: "https://calendar.example/legal/privacy",
  evidenceId: "document-1-section-3",
  context: note,
};
const page = `<html lang="en"><title>Privacy policy</title><main><h1>Privacy notice</h1><h2>Sharing of information</h2><ul>
  <li>Data Hosts, Ltd.<br>We use their servers to store booking data.</li>
  <li>Mail service. We use the service to send booking confirmations. Details are at https://private.example/path?key=SECRET.</li>
  <li>We use a separate provider to process payment information from account holders.</li>
  </ul><a href="https://further.example/privacy">Further privacy policy</a></main></html>`;

it("links only explicit external policy URLs from a site sharing section and excludes self-hosted tools", () => {
  const doc =
    load(`<main><h2>Optional booking embed</h2><p>${note} See <a href="${ref.url}#policy">Calendar privacy policy</a>.
    <a href="https://secret.example/privacy?token=one">Other privacy policy</a>.
    </p><h2>Sharing</h2><p>Our self-hosted inquiry system handles email. <a href="https://software.example/privacy">Software privacy policy</a>.</p></main>`);
  const [booking, selfHosted] = extractPolicySections(
    doc,
    new URL("https://site.example/privacy"),
  );
  expect(booking.providerPolicyUrls).toEqual([ref.url]);
  expect(selfHosted.providerPolicyUrls).toBeUndefined();
});

it("stores activity-matched provider passages with source provenance and does not follow downstream links", async () => {
  const get = vi.fn(async (url: URL) => ({ url, html: page }));
  const rows = await providerPolicyEvidence(
    scanId,
    [ref, ref],
    get,
    new AbortController().signal,
  );
  expect(get).toHaveBeenCalledTimes(1);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(evidence.parse(row)).toMatchObject({
      scanId,
      kind: "third_party_reference",
      url: ref.url,
      language: "en",
      observation: {
        type: "provider_policy",
        providerHost: "calendar.example",
        referringEvidenceId: ref.evidenceId,
        heading: "Sharing of information",
      },
    });
    expect(row.excerpt).toMatch(/booking/);
    expect(row.excerpt).not.toMatch(/payment|SECRET/);
  }
});

it("bounds attempts and refuses scope-changing redirects, link-only assertions, and unrelated policies", async () => {
  const get = vi.fn(async () => ({
    url: new URL("https://redirected.example/privacy"),
    html: page,
  }));
  const rows = await providerPolicyEvidence(
    scanId,
    [
      {
        ...ref,
        context: "We no longer use the booking service provided by Calendar.",
      },
      { ...ref, context: "Booking tools: comparative reading material." },
      { ...ref, url: "https://private.example/privacy?access_token=abc" },
      ref,
      { ...ref, url: "https://another.example/privacy" },
      { ...ref, url: "https://not-fetched.example/privacy" },
    ],
    get,
    new AbortController().signal,
  );
  expect(get).toHaveBeenCalledTimes(2);
  expect(rows).toEqual([]);
  const unrelated = await providerPolicyEvidence(
    scanId,
    [ref],
    async (url) => ({ url, html: page.replaceAll("booking", "loyalty") }),
    new AbortController().signal,
  );
  expect(unrelated).toEqual([]);
});
