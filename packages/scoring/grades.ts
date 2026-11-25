export const methodologyVersion = "1.0.0";
export const grades = [
  [90, "Excellent"],
  [75, "Good"],
  [60, "Mixed"],
  [40, "Concerning"],
  [20, "Poor"],
  [0, "Critical"],
] as const;

export function gradeForScore(score: number) {
  return grades.find(([minimum]) => score >= minimum)![1];
}
