import type {
  ConsentTakeaway,
  Evidence,
  PublishedScoring,
} from "@datadeal/contracts";

export function acceptedExposureSummary(
  baseline: PublishedScoring | null,
  accepted: PublishedScoring | undefined,
  sources: ReadonlyMap<string, Evidence>,
  scanId?: string,
): ConsentTakeaway | undefined {
  if (
    !scanId ||
    baseline?.score == null ||
    accepted?.score == null ||
    accepted.score >= baseline.score
  )
    return;
  for (const factor of [...accepted.adjustments].sort(
    (a, b) => a.adjustment - b.adjustment,
  )) {
    const before =
      baseline.adjustments.find((row) => row.rule === factor.rule)
        ?.adjustment ?? 0;
    if (factor.adjustment >= 0 || factor.adjustment >= before) continue;
    const source = factor.evidenceIds
      .map((id) => sources.get(id))
      .find(
        (item) =>
          item?.scanId === scanId &&
          item.kind === "observed_technical" &&
          item.consentScenario === "accepted" &&
          item.excerpt,
      );
    if (!source) continue;
    const where =
      source.observation?.type === "browser_content_page" ||
      source.id.startsWith("browser-page-")
        ? " on a sampled page"
        : "";
    const recipient =
      source.observation?.type === "browser_request_fields"
        ? source.observation.targetDomain
        : "an outside domain";
    const timing =
      source.observation?.type === "browser_request_fields" &&
      source.observation.phase === "after_choice"
        ? "After accepting all"
        : "During the accept-all visit";
    const observed = {
      recognized_tracking_storage:
        "the browser found persistent storage matching a known analytics or advertising pattern",
      external_email_field: `the browser sent an email-shaped value in an email field to ${recipient}`,
      external_advertising_field: `the browser sent an advertising identifier field to ${recipient}`,
      external_identifier_context: `the browser sent an identifier together with page, referrer or event information to ${recipient}`,
    };
    if (!Object.hasOwn(observed, factor.rule)) continue;
    return {
      text: `${timing}${where}, ${observed[factor.rule as keyof typeof observed]}.`,
      evidenceId: source.id,
    };
  }
}
