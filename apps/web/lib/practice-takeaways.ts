import type {
  DataPractice,
  Evidence,
  PublishedScoring,
  ScanReport,
} from "@datadeal/contracts";
import { measuredPracticeFacts, practiceEvidenceText } from "./content-pages";
import { c15tChoiceDisclosure } from "@datadeal/contracts/c15t-choice";

type Scenario = DataPractice["scenario"];
type Citation = { id: string; label: string; quote?: string };
export type PracticeTakeaway = Pick<
  DataPractice,
  | "factId"
  | "scenario"
  | "control"
  | "trigger"
  | "summary"
  | "significance"
  | "unknowns"
  | "mismatch"
  | "confidence"
> & {
  provenance: "Observed" | "Policy";
  citations: Citation[];
  linkedRequest?: { recipient: string; linkage: string };
  quietVisit?: true;
  choiceStorage?: {
    policyId: string;
    visitId: string;
    mechanism: "cookie" | "local_storage";
  };
};

export function practiceEvidenceLabel(row: Evidence) {
  const obs = row.observation;
  if (obs?.type === "policy_section") return "Policy · " + obs.heading;
  if (row.kind === "declared_first_party") return "Website policy";
  if (row.kind === "declared_processor") return "Provider disclosure";
  if (row.kind === "inferred_infrastructure") return "Infrastructure inference";
  if (obs?.type === "browser_request_fields")
    return "Request to " + obs.targetDomain;
  if (obs?.type === "browser_content_page" && row.url)
    return "Sampled visit · " + new URL(row.url).pathname;
  if (row.kind === "observed_technical") return "Browser observation";
  return "Supporting source";
}

export function practiceTakeaways(
  report: ScanReport | undefined,
  scenario: Scenario,
  ratings: Partial<Record<Scenario, PublishedScoring | null | undefined>>,
  advanced: boolean,
): PracticeTakeaway[] {
  if (!report?.dataPractices?.length) return [];
  const facts = new Map(
    measuredPracticeFacts(report).map((fact) => [fact.factId, fact]),
  );
  const evidence = new Map(
    report.evidence
      .filter((row) => row.scanId === report.id && row.excerpt)
      .map((row) => [row.id, row]),
  );
  const rows = report.dataPractices
    .flatMap((practice) => {
      const { behavior, context, link } = practice.evidence;
      const ids = [...new Set([...behavior, ...context, ...link])];
      if (!ids.length || ids.some((id) => !evidence.has(id))) return [];
      if (
        practice.operation === "declared" ? !context.length : !behavior.length
      )
        return [];
      if (
        behavior.some(
          (id) =>
            evidence.get(id)?.kind !== "observed_technical" ||
            evidence.get(id)?.consentScenario !== practice.scenario,
        )
      )
        return [];
      const fact = facts.get(practice.factId);
      // A sampled visit contains multiple possible actions. The visit ID alone
      // cannot substantiate a legacy transmission or storage claim.
      if (behavior.some((id) => id.startsWith("browser-page-"))) {
        if (
          !fact ||
          fact.page !== "sampled_page" ||
          fact.scenario !== practice.scenario ||
          practice.control !== fact.trigger ||
          behavior.length !== fact.evidenceIds.length ||
          !fact.evidenceIds.every((id) => behavior.includes(id)) ||
          practice.recipient !== (fact.request?.targetDomain ?? null)
        )
          return [];
        const linked =
          fact.linkage !== "unlinked" && Boolean(fact.request?.responses);
        const operation = linked
          ? "stored_and_transmitted"
          : fact.request
            ? fact.request.responses
              ? "transmitted"
              : "attempted"
            : fact.storage
              ? "stored"
              : "observed_visit";
        if (
          operation !== practice.operation ||
          linked !== practice.linkedIdentifier
        )
          return [];
      }
      const rating = ratings[
        practice.scenario
      ]?.practiceAssessment?.ratings.find(
        (row) => row.factId === practice.factId,
      )?.score;
      const mismatch =
        context.some((id) =>
          ["declared_first_party", "declared_processor"].includes(
            evidence.get(id)!.kind,
          ),
        ) && behavior.length
          ? practice.mismatch
          : null;
      const citations = ids.map((id) => {
        const source = evidence.get(id)!;
        const quote =
          practice.contextQuote?.source === id &&
          source.excerpt.includes(practice.contextQuote.text)
            ? practice.contextQuote.text
            : fact && practiceEvidenceText(fact, id);
        return { id, label: practiceEvidenceLabel(source), quote };
      });
      const choicePolicy =
        fact &&
        practice.operation === "stored" &&
        practice.purpose === "consent"
          ? c15tChoiceDisclosure(fact, evidence)
          : undefined;
      const mechanism = fact?.storage?.mechanism;
      const entry: PracticeTakeaway = {
        factId: practice.factId,
        scenario: practice.scenario,
        control: practice.control,
        trigger: practice.trigger,
        summary: practice.summary,
        significance: practice.significance,
        unknowns: practice.unknowns,
        mismatch,
        confidence: practice.confidence,
        provenance: practice.operation === "declared" ? "Policy" : "Observed",
        citations,
        ...(fact?.request?.responses &&
          fact.scenario === practice.scenario &&
          fact.trigger === practice.control &&
          fact.request.targetDomain === practice.recipient &&
          fact.linkage !== "unlinked" &&
          practice.linkedIdentifier &&
          practice.operation === "stored_and_transmitted" && {
            linkedRequest: {
              recipient: fact.request.targetDomain,
              linkage: fact.linkage,
            },
          }),
        ...(fact?.observed === "empty_visit" &&
          fact.scenario === practice.scenario &&
          fact.trigger === practice.control &&
          practice.operation === "observed_visit" &&
          behavior.length === 1 &&
          behavior[0] === fact.evidenceIds[0] && { quietVisit: true }),
        ...(choicePolicy &&
          context.includes(choicePolicy.id) &&
          fact?.scenario === practice.scenario &&
          fact.trigger === practice.control &&
          behavior.includes(fact.evidenceIds[0]!) &&
          (mechanism === "cookie" || mechanism === "local_storage") && {
            choiceStorage: {
              policyId: choicePolicy.id,
              visitId: fact.evidenceIds[0]!,
              mechanism,
            },
          }),
      };
      return [
        {
          entry,
          rating,
          warning: !!mismatch || (rating != null && rating < 60),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.warning) - Number(a.warning) ||
        Number(b.entry.scenario === scenario) -
          Number(a.entry.scenario === scenario) ||
        (a.rating ?? 101) - (b.rating ?? 101),
    );
  if (advanced) return rows.map((row) => row.entry);
  const featured = new Set<string>();
  return rows.flatMap(({ entry, warning }, index) => {
    const key = practiceGroupKey(entry);
    if (!featured.has(key)) {
      if (!warning && featured.size >= 3) return [];
      featured.add(key);
      return [entry];
    }
    // Show how the preference behaves on the homepage for both choices.
    // Keep additional sampled-page observations in the detailed report.
    const visit =
      entry.choiceStorage && evidence.get(entry.choiceStorage.visitId);
    return warning ||
      index < 3 ||
      visit?.observation?.type === "browser_consent_counts"
      ? [entry]
      : [];
  });
}

function practiceGroupKey(row: PracticeTakeaway) {
  if (row.quietVisit && !row.mismatch) return "quiet-visit/" + row.scenario;
  return row.choiceStorage && !row.mismatch
    ? "privacy-choice/" + row.choiceStorage.policyId
    : row.scenario + "/" + row.factId;
}

/** Mechanisms share a finding only for a documented preference. Empty visits
 * with identical measured outcomes can also share a scenario-scoped finding. */
export function groupPracticeTakeaways(rows: PracticeTakeaway[]) {
  const groups = new Map<string, PracticeTakeaway[]>();
  for (const row of rows) {
    // Group the shared measured outcome. A provider's purpose and the limits
    // of each individual visit stay attached to that visit inside the group.
    const key =
      row.linkedRequest && !row.mismatch
        ? JSON.stringify([
            "observed-match",
            row.linkedRequest.recipient,
            row.linkedRequest.linkage,
            row.scenario,
            row.control,
            row.summary,
          ])
        : practiceGroupKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return Array.from(groups, ([id, observations]) => ({
    id,
    observations,
    choice: !!observations[0]!.choiceStorage && !observations[0]!.mismatch,
  }));
}
