import type { ScanReport } from "@datadeal/contracts";
import {
  acceptAllScoreChange,
  verifiedAcceptAllRating,
} from "@datadeal/scoring";
import { practiceEvidenceLabel } from "./practice-takeaways";

function scoreDrivers(report: ScanReport) {
  const rating = verifiedAcceptAllRating(report);
  const score = rating?.score;
  if (
    !rating ||
    score == null ||
    !rating.rulesRevision ||
    !rating.practiceAssessment
  )
    return;
  if (
    rating.practiceAssessment.ratings.some(
      (item) => item.score !== null && item.score < score,
    )
  )
    return;
  const sources = new Map(
    report.evidence
      .filter((row) => row.scanId === report.id)
      .map((row) => [row.id, practiceEvidenceLabel(row)] as const),
  );
  const reasons = new Map<string, string[]>();
  for (const item of rating.practiceAssessment.ratings) {
    if (item.score !== rating.score) continue;
    if (
      !item.evidenceIds.length ||
      item.evidenceIds.some((id) => !sources.has(id))
    )
      return;
    const ids = reasons.get(item.reason) ?? [];
    for (const id of item.evidenceIds) if (!ids.includes(id)) ids.push(id);
    reasons.set(item.reason, ids);
  }
  if (!reasons.size) return;
  return {
    scanId: report.id,
    date: report.completedAt,
    score,
    reasons: Array.from(reasons, ([text, ids]) => ({
      text,
      sources: ids.map((id) => ({ id, label: sources.get(id)! })),
    })),
  };
}

export function changedScoreDrivers(previous: ScanReport, current: ScanReport) {
  if (
    !acceptAllScoreChange(previous, current) ||
    Date.parse(previous.completedAt) >= Date.parse(current.completedAt)
  )
    return;
  const earlier = scoreDrivers(previous);
  const later = scoreDrivers(current);
  if (earlier && later) return { earlier, later };
}

export function documentChanges(previous: ScanReport, current: ScanReport) {
  const captured = current.evidence.filter(
    (item) => item.scanId === current.id && item.url && item.hash,
  );
  if (!captured.length) return null;
  const earlier = new Map(
    previous.evidence.flatMap((item) =>
      item.scanId === previous.id && item.url && item.hash
        ? [[item.url, item] as const]
        : [],
    ),
  );
  return captured.flatMap((item) => {
    if (!item.url) return [];
    const old = earlier.get(item.url);
    if (old?.hash === item.hash) return [];
    const before = old?.excerpt.split(/\s+/) ?? [];
    const after = item.excerpt.split(/\s+/);
    const firstDifference = Array.from({
      length: Math.max(before.length, after.length),
    }).findIndex((_, index) => before[index] !== after[index]);
    const start = Math.max(0, firstDifference - 8);
    return [
      {
        evidenceId: item.id,
        url: item.url,
        kind: old ? "Text changed" : "Newly retrieved",
        ...(old && firstDifference >= 0
          ? {
              passage: {
                before: before.slice(start, start + 38).join(" "),
                after: after.slice(start, start + 38).join(" "),
              },
            }
          : {}),
      },
    ];
  });
}
