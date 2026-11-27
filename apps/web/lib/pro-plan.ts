import {
  proIncludedWatches,
  proMonthlyBoosts,
} from "@datadeal/contracts/paper-plane";

/** What Pro includes, in the words the pricing and billing pages use. */
export const proPlanFeatures = [
  "Ad-free everywhere",
  "Every advanced report open",
  `${proIncludedWatches} watched sites with weekly email alerts`,
  `${proMonthlyBoosts} free “skip the line” scans a month`,
] as const;
