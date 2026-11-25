"use client";

import {
  useConsent,
  useExplicitChoice,
  usePolicyRule,
  usePrivacySignals,
  useRestrictions,
  useSnapshot,
} from "@c15t/nextjs";
import { limitedAdsCopyRevision } from "../../c15t.config";

export function useHasExplicitConsentChoice() {
  const choice = useExplicitChoice();
  return Boolean(choice && Object.keys(choice.categories).length);
}

export function useLimitedAdsPurposeOffered() {
  const rule = usePolicyRule();
  const registered = useSnapshot().consentCategories?.includes("experience");
  return (
    Boolean(registered) &&
    rule.model === "opt-in" &&
    rule.copyRevision === limitedAdsCopyRevision &&
    rule.scope.includes("experience")
  );
}

export function useAdvertisingConsent() {
  const effective = useConsent("marketing");
  const limitedEffective = useConsent("experience");
  const limitedOffered = useLimitedAdsPurposeOffered();
  const signaled = usePrivacySignals().gpc.active;
  const choice = useExplicitChoice();
  const restrictions = useRestrictions();
  if (signaled || restrictions.marketing?.includes("gpc")) {
    if (
      limitedOffered &&
      limitedEffective &&
      choice?.categories.experience?.value === true
    )
      return "limited";
    return "privacy-signal";
  }
  return effective && choice?.categories.marketing?.value === true
    ? "allowed"
    : "needs-choice";
}
