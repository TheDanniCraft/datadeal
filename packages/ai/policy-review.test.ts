import { scanReport, type Evidence } from "@datadeal/contracts";
import { expect, it, vi } from "vitest";
import {
  completePolicyReview,
  openAIAnalyzer,
  publishPolicyClaims,
  validateCandidates,
} from "./index";

const base = {
  scanId: "4f18b745-de5d-413c-8b4c-3d399c07b8cd",
  retrievedAt: "2026-11-25T12:00:00Z",
};
const visit: Evidence = {
  ...base,
  id: "visit",
  kind: "observed_technical",
  excerpt: "The browser visited the homepage.",
  consentScenario: "default",
  observation: {
    type: "browser_consent_counts",
    requests: 4,
    cookies: 1,
    externalDomains: [],
  },
};
const policy: Evidence = {
  ...base,
  id: "policy-2",
  kind: "declared_first_party",
  excerpt:
    "We keep donor records for three years after your last donation unless a dispute remains open.",
  observation: {
    type: "policy_section",
    heading: "Retention",
    topic: "retention",
  },
};
const sharing: Evidence = {
  ...base,
  id: "policy-3",
  kind: "declared_first_party",
  excerpt:
    "When you request a booking, we share your contact details with the booking provider.",
  observation: { type: "policy_section", heading: "Booking", topic: "sharing" },
};
const original = validateCandidates(
  {
    findings: [],
    claims: [
      {
        category: "browser_observation",
        claim: "One cookie remained at the end.",
        evidenceIds: [visit.id],
        confidence: "high",
        missingInformation: [],
        contradictions: [],
        humanReview: false,
      },
    ],
    practices: [],
  },
  [visit, policy],
);
const retention = {
  topic: "retention",
  source: policy.id,
  text: "The policy says donor records are kept for three years after your last donation, or longer during an open dispute.",
  quote: policy.excerpt,
  confidence: "high",
};
const recipient = {
  topic: "sharing",
  source: sharing.id,
  text: "When you request a booking, the booking provider receives your contact details.",
  quote: sharing.excerpt,
  confidence: "moderate",
};
const complete = (...summaries: unknown[]) =>
  vi.fn(async () => JSON.stringify({ summaries }));

it("recovers a publishable retention claim from a typed section while preserving the browser review", async () => {
  const input = [policy, visit];
  const call = vi.fn(async (_instructions: string, content: string) => {
    expect(JSON.parse(content)).toEqual([
      { source: policy.id, topic: "retention", excerpt: policy.excerpt },
    ]);
    return JSON.stringify({ summaries: [retention] });
  });
  const result = await completePolicyReview(original, input, call);
  expect(call).toHaveBeenCalledTimes(1);
  expect(result.practices).toBe(original.practices);
  expect(result.claims).toContain(original.claims[0]);
  expect(publishPolicyClaims(result, input, base.scanId)).toEqual([
    {
      category: "retention",
      confidence: "high",
      text: retention.text,
      source: policy.id,
      quote: policy.excerpt,
    },
  ]);
  const shouldSkip = complete(retention);
  expect(await completePolicyReview(result, input, shouldSkip)).toBe(result);
  expect(shouldSkip).not.toHaveBeenCalled();
});

it("keeps separately supported sentences and drops cross-topic and invented citations", async () => {
  const input = [visit, policy, sharing];
  const result = await completePolicyReview(
    original,
    input,
    complete(
      { ...retention, quote: "A made-up claim about a one-year period." },
      { ...recipient, source: policy.id },
      recipient,
    ),
  );
  expect(result.brief).toEqual([
    {
      topic: "sharing",
      text: recipient.text,
      source: sharing.id,
      quote: sharing.excerpt,
    },
  ]);
  expect(result.claims).toEqual(original.claims);
  const skip = complete();
  expect(await completePolicyReview(result, input, skip)).toBe(result);
  expect(skip).not.toHaveBeenCalled();
});

it("fits a full qualified retention passage into the persisted report contract", async () => {
  const quote =
    "We keep the information about an application while the applicant takes part in the programme and for a limited period after their participation ends, or longer if an unresolved legal claim requires us to keep those records until the dispute is closed.";
  expect(quote.length).toBeGreaterThan(220);
  const evidence = [visit, { ...policy, excerpt: quote }];
  const text =
    "The policy says application records are kept during participation and for a limited time afterward, or longer for unresolved legal claims.";
  const result = await completePolicyReview(
    original,
    evidence,
    complete({ ...retention, text, quote }),
  );
  const claims = publishPolicyClaims(result, evidence, base.scanId);
  expect(scanReport.shape.policyClaims.parse(claims)).toMatchObject([
    { text, quote },
  ]);
});

it("keeps scored evidence when the optional call fails or when evidence scope precludes recovery", async () => {
  for (const invoke of [
    async () => {
      throw new Error("offline");
    },
    async () => "invalid JSON",
    complete(),
  ]) {
    expect(await completePolicyReview(original, [visit, policy], invoke)).toBe(
      original,
    );
  }
  const skip = complete();
  for (const input of [
    [policy],
    [visit, { ...policy, scanId: "another" }],
    [visit, { ...policy, kind: "third_party_reference" as const }],
    [visit, { ...policy, observation: undefined }],
  ]) {
    expect(await completePolicyReview(original, input, skip)).toBe(original);
  }
  const disputed = {
    ...original,
    claims: [
      { ...original.claims[0], evidenceIds: [policy.id], humanReview: true },
    ],
  };
  expect(await completePolicyReview(disputed, [visit, policy], skip)).toBe(
    disputed,
  );
  expect(skip).not.toHaveBeenCalled();
});

it("calls the production adapter with the dedicated bounded policy prompt", async () => {
  const calls: { max_completion_tokens: number; contents: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      const prompt = payload.messages[0].content;
      calls.push({
        max_completion_tokens: payload.max_completion_tokens,
        contents: payload.messages[1].content,
      });
      const result = prompt.startsWith("Review each indexed")
        ? { judgments: [] }
        : prompt.startsWith("Write a short English visitor summary")
          ? { summaries: [recipient] }
          : original;
      return Response.json({
        choices: [{ message: { content: JSON.stringify(result) } }],
      });
    }),
  );
  try {
    const result = await openAIAnalyzer("test", "test").analyze([
      visit,
      sharing,
    ]);
    expect(result.brief?.[0].source).toBe(sharing.id);
    expect(calls.filter((c) => c.max_completion_tokens === 1200)).toHaveLength(
      1,
    );
    expect(calls.at(-1)?.contents).not.toContain(visit.excerpt);
  } finally {
    vi.unstubAllGlobals();
  }
});
