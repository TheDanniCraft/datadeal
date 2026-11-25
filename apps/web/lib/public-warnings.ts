import type { Finding } from "@datadeal/contracts";

export function isPublicWarning(item: Finding) {
  return (
    item.severity === "critical" ||
    item.rule === "transfer_risk" ||
    item.rule === "sensitive_processing"
  );
}
