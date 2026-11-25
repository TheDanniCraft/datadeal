import { describe, expect, test } from "vitest";
import type {
  InventoryClassification,
  RecipientItem,
  StorageInventory,
  StorageItem,
} from "@datadeal/contracts/storage-inventory";
import { combineCosts, inventoryRating } from "./inventory";

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
const rate = (
  inv: StorageInventory,
  scenario: "default" | "rejected" | "accepted" = "accepted",
) => inventoryRating({ storageInventory: inv }, scenario)!;

describe("worked examples from docs/scoring-v2.md", () => {
  test("consent record and support chat only: Excellent", () => {
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
      score: 100,
      grade: "Excellent",
      rulesRevision: "contextual-practices-6",
    });
  });

  test("cloud analytics without an ID: 97", () => {
    const plausible = recipient("plausible.io", { fields: ["page_url"] });
    const r = rate(
      inventory([[plausible, classify(plausible, "analytics", "processor")]]),
    );
    expect(r.score).toBe(97);
  });

  test("shop with _ga and a linked Meta pixel: 65 Mixed", () => {
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
    expect(r).toMatchObject({ score: 65, grade: "Mixed" });
    expect(r.inventoryAssessment?.costs.map((c) => c.cost)).toEqual([
      25, 15, 10,
    ]);
  });

  test("thirty ad partners score far below one", () => {
    const rows: [RecipientItem, InventoryClassification][] = Array.from(
      { length: 30 },
      (_, i) => {
        const r = recipient(`ads${i}.example`, { fields: ["advertising_id"] });
        return [r, classify(r, "advertising", "independent")];
      },
    );
    const one = rate(inventory(rows.slice(0, 1)));
    const thirty = rate(inventory(rows));
    expect(one.score).toBe(75);
    expect(thirty.score).toBe(0);
    expect(thirty.grade).toBe("Critical");
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
    expect(r.score).toBe(78);
  });

  test("a preference that looks like a flag is free even if purpose is analytics", () => {
    const theme = storage("theme", flag);
    expect(
      rate(inventory([[theme, classify(theme, "preferences")]])).score,
    ).toBe(100);
  });

  test("unknown identifiers cost a little and lower confidence", () => {
    const rows: [StorageItem, InventoryClassification][] = Array.from(
      { length: 5 },
      (_, i) => {
        const s = storage("x" + i, id);
        return [s, classify(s, "unknown", "unknown")];
      },
    );
    const r = rate(inventory(rows));
    expect(r.score).toBe(Math.round(100 - combineCosts([4, 4, 4, 4, 4])));
    expect(r.confidence).toBe("Low");
    expect(r.inventoryAssessment?.unknownItems).toBe(5);
  });

  test("email to an advertiser is the worst case", () => {
    const pixel = recipient("ads.example", { fields: ["email", "identifier"] });
    expect(
      rate(inventory([[pixel, classify(pixel, "advertising", "independent")]]))
        .score,
    ).toBe(65);
  });

  test("scenarios only include items present in their phases", () => {
    const fbp = storage("_fbp", id, ["after_accept"]);
    const inv = inventory([[fbp, classify(fbp, "advertising", "independent")]]);
    expect(rate(inv, "default").score).toBe(100);
    expect(rate(inv, "rejected").score).toBe(100);
    expect(rate(inv, "accepted").score).toBe(85);
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
    expect(r.verdict).not.toMatch(/email/);
  });
});
