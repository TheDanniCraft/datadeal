import type { Finding, ScanReport } from "@datadeal/contracts";

const fixtures = [
  ["thedannicraft.de", false, false],
  ["google.com", true, true],
  ["bild.de", true, false],
  ["datadeal.app", true, true],
  ...(process.env.DATADEAL_BROWSER_TEST === "true"
    ? ([["example.org", false, false]] as const)
    : []),
] as const;

export const demos: ScanReport[] = fixtures.map(
  ([domain, ads, controls], index) => {
    const id = "00100000-0000-4000-8000-00000000000" + index;
    const completedAt = "2026-01-01T12:00:00.000Z";
    const observations: Array<{
      rule: Finding["rule"];
      title: string;
      excerpt: string;
      severity: Finding["severity"];
    }> = [
      {
        rule: "policy_available",
        title: "Privacy documentation available",
        excerpt:
          "The operator provides a summary of how it processes personal information.",
        severity: "positive",
      },
      ...(controls
        ? [
            {
              rule: "optional_control",
              title: "Optional consent can be rejected",
              excerpt:
                "A visible consent control lets visitors reject all optional categories.",
              severity: "positive",
            } as const,
          ]
        : []),
      ...(ads
        ? [
            {
              rule: "independent_ads",
              title: "Independent advertising provider detected",
              excerpt:
                "The default visit includes a request to an independent advertising network.",
              severity: "caution",
            } as const,
          ]
        : []),
      {
        rule: "necessary_processor",
        title: "Hosting supports site delivery",
        excerpt:
          "The hosting provider delivers the site. Its presence receives no score penalty.",
        severity: "informational",
      },
    ];
    return {
      id,
      domain,
      completedAt,
      partial: !ads && !controls,
      demo: true,
      preferredPolicyEvidenceId:
        domain === "example.org" ? "example-collection" : undefined,
      evidence: [
        ...observations.map((item, i) => ({
          id: "example-" + i,
          kind: "observed_technical" as const,
          retrievedAt: completedAt,
          scanId: id,
          excerpt: item.excerpt,
          consentScenario:
            item.rule === "independent_ads" ? ("default" as const) : undefined,
        })),
        ...(domain === "example.org"
          ? [
              ...(["default", "rejected"] as const).map((scenario) => ({
                id: "example-visit-" + scenario,
                kind: "observed_technical" as const,
                retrievedAt: completedAt,
                scanId: id,
                excerpt: "A request to an external destination was observed.",
                consentScenario: scenario,
                observation: {
                  type: "browser_consent_counts" as const,
                  requests: 2,
                  cookies: 0,
                  externalDomains: ["example.net"],
                  responseDomains:
                    scenario === "default" ? ["example.net"] : [],
                  afterChoice:
                    scenario === "rejected"
                      ? { requests: 1, externalDomains: ["example.net"] }
                      : undefined,
                },
              })),
              {
                id: "example-sharing",
                kind: "declared_first_party" as const,
                retrievedAt: completedAt,
                scanId: id,
                excerpt: "We share your address with our delivery provider.",
                observation: {
                  type: "policy_section" as const,
                  heading: "How we share information",
                  topic: "sharing" as const,
                },
              },
              {
                id: "example-collection",
                kind: "declared_first_party" as const,
                retrievedAt: completedAt,
                scanId: id,
                excerpt:
                  "We collect your email address when you create an account.",
                observation: {
                  type: "policy_section" as const,
                  heading: "Information we collect",
                  topic: "collection" as const,
                },
              },
            ]
          : []),
      ],
      findings: observations.map((item, i) => ({
        rule: item.rule,
        title: item.title,
        explanation: item.excerpt,
        severity: item.severity,
        confidence: "moderate",
        evidenceIds: ["example-" + i],
      })),
    };
  },
);
