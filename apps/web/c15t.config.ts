import { defineConsentConfig, hosted, local } from "@c15t/nextjs";

const backendURL = process.env.NEXT_PUBLIC_C15T_BACKEND_URL;
export const limitedAdsCopyRevision = "datadeal-limited-google-ads-1";
const privacyChoices = {
  model: "opt-in",
  categories: ["functionality", "measurement", "marketing"] as string[],
  prompt: "choice",
  actions: ["accept", "reject", "customize"] as (
    "accept" | "reject" | "customize"
  )[],
  privacySignals: { gpc: { denyCategories: ["marketing"] as string[] } },
  scopeMode: "strict",
} as const;

// DataDeal reserves c15t's "experience" category for limited Google ads.
function consentConfig(limitedDisplay: boolean) {
  const choices = limitedDisplay
    ? {
        ...privacyChoices,
        copyRevision: limitedAdsCopyRevision,
        categories: [...privacyChoices.categories, "experience"],
      }
    : privacyChoices;
  return defineConsentConfig({
    options: {
      i18n: {
        messages: {
          en: {
            consentTypes: {
              measurement: {
                title: "Analytics",
                description:
                  "Allow DataDeal to count visits to public page types with self-hosted Umami when available. Report domains and account details stay out of pageviews.",
              },
              ...(limitedDisplay && {
                experience: {
                  title: "Limited Google ads",
                  description:
                    "Google receives technical information such as your IP address to serve ads without personalization. A rewarded ad starts only if you separately choose to watch it.",
                },
              }),
            },
          },
        },
      },
    },
    mode: backendURL
      ? hosted({ backendURL })
      : local({
          acknowledgeNoRecords: true,
          policyRules: [
            {
              id: "unknown-location",
              match: { fallback: true },
              ...choices,
            },
            {
              id: "worldwide",
              match: { isDefault: true },
              ...choices,
            },
          ],
        }),
  });
}
export const limitedDisplayConsentConfig = consentConfig(true);
export default consentConfig(false);
