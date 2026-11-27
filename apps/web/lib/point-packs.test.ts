import { afterEach, expect, it, vi } from "vitest";
import {
  describePointPacks,
  parsePointPacks,
  pointPackConfig,
  purchasablePointPacks,
} from "./point-packs";
import { localPointsEnabled } from "./local-reward";
vi.mock("./local-reward", () => ({ localPointsEnabled: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function sandbox(env: Record<string, string>) {
  for (const [key, value] of Object.entries({
    CREEM_MODE: "test",
    CREEM_API_KEY: "test-key",
    CREEM_WEBHOOK_SECRET: "secret",
    CREEM_MONTHLY_PRODUCT: "prod_month",
    CREEM_YEARLY_PRODUCT: "prod_year",
    CREEM_POINT_PACKS: "",
    CREEM_CREDIT_PACK_PRODUCT: "",
    CREEM_CREDIT_PACK_CREDITS: "",
    CREEM_CREDIT_PACK_PRICE_CENTS: "",
    APP_ORIGIN: "http://localhost:3000",
    ...env,
  }))
    vi.stubEnv(key, value);
}

it("parses packs sorted by points and tolerates spacing", () => {
  expect(
    parsePointPacks(" 50000:2000:prod_l , 10000:500:prod_s,25000:1100:prod_m "),
  ).toEqual([
    { points: 10000, price: 500, product: "prod_s" },
    { points: 25000, price: 1100, product: "prod_m" },
    { points: 50000, price: 2000, product: "prod_l" },
  ]);
});

it.each([
  undefined,
  "",
  "10000:500",
  "10000:500:prod:extra",
  "0:500:prod",
  "10000:99:prod",
  "-5:500:prod",
  "1.5:500:prod",
  "10000:500:bad product",
  "10000:500:prod_a,25000:1100:prod_a",
  "10000:500:prod_a,10000:600:prod_b",
  "10000:500:prod_a,",
])("withholds every pack for %j", (value) => {
  expect(parsePointPacks(value)).toBeNull();
});

it("derives one pack from the earlier credit pack only when no point packs are set", () => {
  sandbox({
    CREEM_CREDIT_PACK_PRODUCT: "prod_credit",
    CREEM_CREDIT_PACK_CREDITS: "100",
    CREEM_CREDIT_PACK_PRICE_CENTS: "500",
  });
  expect(pointPackConfig()?.packs).toEqual([
    { points: 10000, price: 500, product: "prod_credit" },
  ]);
  vi.stubEnv("CREEM_POINT_PACKS", "25000:1100:prod_m");
  expect(pointPackConfig()?.packs).toEqual([
    { points: 25000, price: 1100, product: "prod_m" },
  ]);
  // A malformed list never falls back to the old pack.
  vi.stubEnv("CREEM_POINT_PACKS", "25000:1100");
  expect(pointPackConfig()).toBeNull();
});

it("sells packs only in test mode, without Pro products, on a loopback origin with local points", () => {
  sandbox({ CREEM_POINT_PACKS: "10000:500:prod_s" });
  vi.mocked(localPointsEnabled).mockReturnValue(true);
  expect(purchasablePointPacks()?.packs).toHaveLength(1);
  vi.mocked(localPointsEnabled).mockReturnValue(false);
  expect(purchasablePointPacks()).toBeNull();
  vi.mocked(localPointsEnabled).mockReturnValue(true);
  vi.stubEnv("APP_ORIGIN", "https://datadeal.example");
  expect(purchasablePointPacks()).toBeNull();
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  vi.stubEnv("CREEM_MODE", "live");
  expect(purchasablePointPacks()).toBeNull();
  vi.stubEnv("CREEM_MODE", "test");
  vi.stubEnv("CREEM_POINT_PACKS", "10000:500:prod_s,25000:1100:prod_year");
  expect(purchasablePointPacks()).toBeNull();
});

it("prices each pack per 1,000 points and its saving against the smallest", () => {
  expect(
    describePointPacks([
      { points: 50000, price: 2000, product: "l" },
      { points: 10000, price: 500, product: "s" },
      { points: 25000, price: 1100, product: "m" },
    ]).map(({ product, perThousand, save }) => [product, perThousand, save]),
  ).toEqual([
    ["s", 50, 0],
    ["m", 44, 12],
    ["l", 40, 20],
  ]);
});
