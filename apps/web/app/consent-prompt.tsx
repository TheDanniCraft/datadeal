"use client";

import {
  ConsentBanner,
  ConsentRoot,
  ConsentTheme,
  usePolicyRule,
  usePrivacySignals,
  useRegisterConsentCategories,
  useSnapshot,
} from "@c15t/nextjs";
import { useEffect, type ReactNode } from "react";
import {
  limitedAdsCopyRevision,
  limitedDisplayConsentConfig,
} from "../c15t.config";

const consentColors = {
  primary: "var(--accent)",
  primaryHover: "var(--accent-hover)",
  textOnPrimary: "var(--accent-foreground)",
  text: "var(--foreground)",
  textMuted: "color-mix(in oklab, var(--foreground) 58%, var(--muted))",
  surface: "var(--surface)",
  surfaceHover: "var(--surface-secondary)",
  border: "var(--border)",
  borderHover: "var(--field-border)",
  overlay: "var(--backdrop)",
  switchTrack: "var(--scrollbar)",
  switchTrackActive: "var(--accent)",
  switchThumb: "var(--snow)",
};
const consentTheme = {
  colors: consentColors,
  dark: {
    ...consentColors,
    primary: "color-mix(in oklab, var(--accent) 64%, var(--foreground))",
    primaryHover: "color-mix(in oklab, var(--accent) 48%, var(--foreground))",
    textOnPrimary: "var(--background)",
  },
  typography: { fontFamily: "var(--font-ui), sans-serif" },
  radius: { md: "var(--radius)", lg: "var(--field-radius)" },
  consentActions: {
    accept: { variant: "primary", mode: "filled" },
    reject: { variant: "primary", mode: "filled" },
    customize: { variant: "neutral", mode: "stroke" },
  },
} as const;

export function ConsentBoundary({
  headerGpc,
  hasLimitedUnit,
  children,
}: {
  headerGpc: boolean;
  hasLimitedUnit: boolean;
  children: ReactNode;
}) {
  const signaled =
    headerGpc ||
    (typeof navigator !== "undefined" &&
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl === true);
  const offerLimited = signaled && hasLimitedUnit;
  return (
    <ConsentRoot
      config={offerLimited ? limitedDisplayConsentConfig : undefined}
      options={{
        theme: consentTheme,
        ...(signaled && {
          ...(headerGpc && { overrides: { gpc: true } }),
          // c15t suppresses a first-visit choice if any offered category has a
          // restriction. Keep marketing blocked and outside the offered scope.
          consentCategories: ["functionality", "measurement"],
        }),
      }}
    >
      <ConsentTheme theme={consentTheme} colorScheme="system" />
      {children}
    </ConsentRoot>
  );
}

export function ConsentPrompt({ hasLimitedUnit }: { hasLimitedUnit: boolean }) {
  const rule = usePolicyRule();
  const signaled = usePrivacySignals().gpc.active;
  const register = useRegisterConsentCategories();
  const registered = useSnapshot().consentCategories?.includes("experience");
  const limited =
    signaled &&
    hasLimitedUnit &&
    rule.model === "opt-in" &&
    rule.copyRevision === limitedAdsCopyRevision &&
    rule.scope.includes("experience");
  // A hosted policy must explicitly publish this purpose and copy revision.
  // An older, generic experience grant cannot authorize limited ad requests.
  useEffect(() => {
    if (limited && !registered) register(["experience"]);
  }, [limited, registered, register]);
  if (limited && !registered) return null;
  return (
    <ConsentBanner
      hideBranding
      {...(signaled && {
        title: "Optional privacy settings",
        description: limited
          ? "Choose optional site features, audience measurement and limited Google ads. Google receives technical information such as your IP address to serve ads without personalization. Watching a rewarded ad is a separate choice."
          : "Choose whether to allow optional site features and audience measurement.",
      })}
    />
  );
}
