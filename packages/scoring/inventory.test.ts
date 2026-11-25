import { describe, expect, test } from "vitest";
import type {
  InventoryClassification,
  RecipientItem,
  StorageInventory,
  StorageItem,
} from "@datadeal/contracts/storage-inventory";
import { combineCosts, inventoryRating, scanCoverage } from "./inventory";

let n = 0;
const hex = () => (++n).toString(16).padStart(12, "0");
const id = { length: "long", shape: "other", identifierLike: true } as const;
const flag = { length: "short", shape: "flag", identifierLike: false } as const;
type Phase = StorageItem["phases"][number];

function storage(
  name: string,
  value: StorageItem["value"],
  phases: Phase[] = ["after_accept"],
): StorageItem {
  return {
    id: "st-" + hex(),
    mechanism: "cookie",
    name,
    site: "site.example",
    scope: "same_site",
    lifetime: "persistent",
    value,
    phases,
    evidenceIds: ["browser-consent-accepted"],
  };
}
function recipient(
  domain: string,
  extra: Partial<RecipientItem> = {},
): RecipientItem {
  return {
    id: "rc-" + hex(),
    domain,
    phases: ["after_accept"],
    fields: [],
    linkedIdentifier: false,
    answered: true,
    evidenceIds: ["browser-consent-accepted"],
    ...extra,
  };
}
const classify = (
  item: { id: string },
  purpose: InventoryClassification["purpose"],
  controller: InventoryClassification["controller"] = "first_party",
): InventoryClassification => ({
  itemId: item.id,
  purpose,
  controller,
  vendor: null,
  confidence: "high",
  reason: "Test classification.",
  basis: "known_convention",
});
function inventory(
  rows: [StorageItem | RecipientItem, InventoryClassification | null][],
): StorageInventory {
  return {
    version: 1,
    storage: rows.flatMap(([r]) => ("mechanism" in r ? [r] : [])),
    recipients: rows.flatMap(([r]) => ("domain" in r ? [r] : [])),
    truncated: false,
    classifications: rows.flatMap(([, c]) => (c ? [c] : [])),
    research: [],
  };
}
// A well-covered scan: all consent scenarios and two sampled pages.
const covered = {
  consentCoverage: {
    default: "measured",
    rejected: "measured",
    accepted: "measured",
  },
  pageSample: {
    discovered: 2,
    discoveryLimited: false,
    limit: 3,
    pages: [1, 2].map((i) => ({
      url: `https://site.example/p${i}`,
      source: "sitemap",
      coverage: {
        default: "measured",
        rejected: "measured",
        accepted: "measured",
      },
    })),
  },
} as const;
const rate = (
  inv: StorageInventory,
  scenario: "default" | "rejected" | "accepted" = "accepted",
  report: object = covered,
) =>
  inventoryRating(
    { ...(report as object), storageInventory: inv } as never,
    scenario,
  )!;

describe("calibration", () => {
  test("nothing found is excellent but not a perfect 100", () => {
    const consent = storage("c15t", flag, [
      "before_choice",
      "after_reject",
      "after_accept",
    ]);
    const chat = storage("cw_conversation", id);
    const r = rate(
      inventory([
        [consent, classify(consent, "consent")],
        [chat, classify(chat, "support", "processor")],
      ]),
    );
    expect(r).toMatchObject({
      score: 99,
      grade: "Excellent",
      rulesRevision: "contextual-practices-7",
    });
  });

  test("cloud analytics without an ID", () => {
    const plausible = recipient("plausible.io", { fields: ["page_url"] });
    expect(
      rate(
        inventory([[plausible, classify(plausible, "analytics", "processor")]]),
      ).score,
    ).toBe(96);
  });

  test("shop with _ga and a linked Meta pixel stays Mixed", () => {
    const ga = storage("_ga", id);
    const fbp = storage("_fbp", id);
    const meta = recipient("facebook.com", {
      fields: ["identifier"],
      linkedIdentifier: true,
    });
    const r = rate(
      inventory([
        [ga, classify(ga, "analytics", "independent")],
        [fbp, classify(fbp, "advertising", "independent")],
        [meta, classify(meta, "advertising", "independent")],
      ]),
    );
    expect(r).toMatchObject({ score: 64, grade: "Mixed" });
  });

  test("count alone cannot push a site to zero, but more trackers still score lower", () => {
    const partners = (n: number) =>
      inventory(
        Array.from({ length: n }, (_, i) => {
          const r = recipient(`ads${i}.example`, {
            fields: ["advertising_id"],
          });
          return [r, classify(r, "advertising", "independent")] as [
            RecipientItem,
            InventoryClassification,
          ];
        }),
      );
    const one = rate(partners(1)).score!;
    const thirty = rate(partners(30)).score!;
    const hundred = rate(partners(100)).score!;
    expect(one).toBe(74);
    expect(thirty).toBe(45);
    expect(thirty).toBeLessThan(one);
    expect(hundred).toBe(thirty); // breadth penalty is capped
    expect(combineCosts([25, ...Array(99).fill(25)])).toBe(55);
  });
});

describe("coverage", () => {
  const clean = () => {
    const consent = storage("c15t", flag);
    return inventory([[consent, classify(consent, "consent")]]);
  };
  test("less coverage pulls the score toward the middle", () => {
    expect(rate(clean()).score).toBe(99);
    const homepageOnly = {
      consentCoverage: {
        ...covered.consentCoverage,
        rejected: "control_unavailable",
      },
    };
    const r = rate(clean(), "accepted", homepageOnly);
    expect(r.score).toBe(92);
    expect(r.inventoryAssessment?.coverage).toMatch(
      /reject choice could not be tested.*only the homepage/,
    );
  });
  test("unknown items reduce coverage and confidence", () => {
    const rows: [StorageItem, InventoryClassification][] = Array.from(
      { length: 5 },
      (_, i) => {
        const s = storage("x" + i, id);
        return [s, classify(s, "unknown", "unknown")];
      },
    );
    const r = rate(inventory(rows));
    expect(r.score).toBe(76);
    expect(r.confidence).toBe("Low");
    expect(
      scanCoverage(covered as never, inventory(rows), 1).coverage,
    ).toBeCloseTo(0.679, 3);
  });
});

describe("rules", () => {
  test("tracking before the choice costs 50% more", () => {
    const fbp = storage("_fbp", id, ["before_choice", "after_accept"]);
    const r = rate(
      inventory([[fbp, classify(fbp, "advertising", "independent")]]),
    );
    expect(r.inventoryAssessment?.costs[0]).toMatchObject({
      cost: 22.5,
      consentPenalty: true,
    });
    expect(r.score).toBe(77);
  });

  test("a preference flag is free", () => {
    const theme = storage("theme", flag);
    expect(
      rate(inventory([[theme, classify(theme, "preferences")]])).score,
    ).toBe(99);
  });

  test("email to an advertiser is the worst case", () => {
    const pixel = recipient("ads.example", { fields: ["email", "identifier"] });
    expect(
      rate(inventory([[pixel, classify(pixel, "advertising", "independent")]]))
        .score,
    ).toBe(65);
  });

  test("a provider named in the policy for a feature costs a little and is labelled", () => {
    const morgen = recipient("morgen.so", {
      phases: ["on_use"],
      answered: false,
    });
    const inv = inventory([[morgen, classify(morgen, "support", "processor")]]);
    const r = rate(inv);
    expect(r.inventoryAssessment?.costs[0]).toMatchObject({ cost: 1 });
    expect(r.inventoryAssessment?.costs[0].label).toMatch(
      /^When you use a feature: morgen\.so/,
    );
    expect(r.inventoryAssessment?.coverage).toMatch(
      /features named in the policy were not tried/,
    );
    expect(r.score).toBe(96);
    // Not part of the before-choice visit.
    expect(rate(inv, "default").score).toBe(97);
  });

  test("a consent penalty does not change which practice the verdict names", () => {
    const permutive = recipient("permutive.app", {
      fields: ["identifier"],
      linkedIdentifier: true,
      phases: ["before_choice", "after_accept"],
    });
    const r = rate(
      inventory([
        [permutive, classify(permutive, "advertising", "independent")],
      ]),
    );
    expect(r.inventoryAssessment?.costs[0].cost).toBe(37.5);
    expect(r.verdict).toBe(
      "Shares browser IDs with advertising companies, some before you agree.",
    );
  });

  test("scenarios only include items present in their phases", () => {
    const fbp = storage("_fbp", id, ["after_accept"]);
    const inv = inventory([[fbp, classify(fbp, "advertising", "independent")]]);
    expect(rate(inv, "default").score).toBe(99);
    expect(rate(inv, "accepted").score).toBe(84);
  });

  test("an unclassified inventory falls back to the previous rules", () => {
    const fbp = storage("_fbp", id);
    expect(
      inventoryRating(
        { storageInventory: inventory([[fbp, null]]) },
        "accepted",
      ),
    ).toBeUndefined();
    expect(inventoryRating({}, "accepted")).toBeUndefined();
  });
});
