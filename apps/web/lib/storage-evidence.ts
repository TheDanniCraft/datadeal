import type { BrowserStorageSnapshot, Evidence } from "@datadeal/contracts";

function describeSnapshot(snapshot: BrowserStorageSnapshot) {
  const { recognized, inspected, total, unclassified } = snapshot.cookies;
  const names = [
    ...new Set(
      recognized.map(
        (cookie) =>
          (cookie.name === "Chatwoot conversation"
            ? "Chatwoot conversation continuity"
            : cookie.name) +
          (cookie.persistent ? " (persistent)" : " (session)"),
      ),
    ),
  ];
  const parts = [
    `inspected ${inspected} of ${total} cookies` +
      (names.length
        ? ", including " + names.join(", ")
        : inspected && !unclassified?.length
          ? " (no recognized family)"
          : ""),
  ];
  const expiryLabels = {
    within_day: "expires within a day",
    within_month: "expiry over 1 day and up to 30 days",
    within_year: "expiry over 30 days and up to 1 year",
    over_year: "expires after a year",
  };
  const groups = (unclassified ?? []).map((group) => {
    const scope =
      group.scope === "same_site"
        ? "same-site"
        : group.scope === "outside_site"
          ? "outside-site"
          : "scope unknown";
    const lifetime = group.persistent ? "persistent" : "session";
    return `${group.count} unclassified ${lifetime} cookie${group.count === 1 ? "" : "s"} (${[group.site, scope, group.expiry && expiryLabels[group.expiry]].filter(Boolean).join(", ")})`;
  });
  if (groups.length)
    parts[0] +=
      (names.length ? ", plus " : ", including ") +
      new Intl.ListFormat("en").format(groups);
  if (snapshot.web) {
    for (const key of ["local", "session"] as const) {
      const store = snapshot.web[key];
      const categories = store.categories.filter(
        (kind) => kind !== "unclassified",
      );
      parts.push(
        `${store.inspected} of ${store.total} ${key} storage keys` +
          (categories.length
            ? " (" +
              categories
                .map((category) =>
                  category === "permutive_visitor_id"
                    ? "Permutive publisher-scoped visitor ID"
                    : category,
                )
                .join(", ") +
              ")"
            : store.inspected
              ? " (unclassified)"
              : ""),
      );
    }
  }
  return new Intl.ListFormat("en").format(parts) + ".";
}

export function storageEvidence(source: Evidence) {
  const visit = source.observation;
  if (
    visit?.type !== "browser_consent_counts" &&
    visit?.type !== "browser_content_page"
  )
    return "";
  const summary = visit.storageSummary;
  if (!summary) return "";
  return [
    summary.beforeChoice &&
      "Immediately before the choice, DataDeal " +
        describeSnapshot(summary.beforeChoice),
    "At the end of the visit, DataDeal " + describeSnapshot(summary.end),
  ]
    .filter(Boolean)
    .join(" ");
}
