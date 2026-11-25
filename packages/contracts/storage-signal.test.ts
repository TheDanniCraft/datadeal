import { describe, expect, test } from "vitest";
import {
  describeStorageValue,
  maskStorageName,
  storageNamePattern,
} from "./browser-storage";

describe("maskStorageName", () => {
  test.each([
    ["_ga", "_ga"],
    ["cw_conversation", "cw_conversation"],
    ["wp_woocommerce_session_8f3a9b2c1d", "wp_woocommerce_session_*"],
    ["intercom-id-a1b2c3d4", "intercom-id-*"],
    ["ajs_user_id", "ajs_user_id"],
    ["mp_0123456789abcdef0123456789abcdef_mixpanel", "mp_*_mixpanel"],
    ["sess_123e4567-e89b-12d3-a456-426614174000", "sess_*"],
    ["user_1234567", "user_*"],
    ["theme preference", "theme~preference"],
    ['a b(c)[d]{e}<f>"g"', "a~b~c~~d~~e~~f~~g~"],
    ["", "~"],
  ])("%s -> %s", (name, masked) => {
    expect(maskStorageName(name)).toBe(masked);
    // Every masked name must pass the published schema.
    expect(storageNamePattern.safeParse(maskStorageName(name)).success).toBe(
      true,
    );
  });
});

describe("describeStorageValue", () => {
  test("preferences are not identifiers", () => {
    for (const value of ["dark", "true", "1", "de-DE", "accepted"])
      expect(describeStorageValue(value)).toMatchObject({
        shape: "flag",
        identifierLike: false,
      });
    expect(describeStorageValue("1764095412")).toMatchObject({
      shape: "timestamp",
      identifierLike: false,
    });
  });
  test("random tokens look like identifiers", () => {
    expect(
      describeStorageValue("123e4567-e89b-12d3-a456-426614174000"),
    ).toMatchObject({ shape: "uuid", identifierLike: true });
    expect(describeStorageValue("GA1.1.1234567890.1764095412")).toMatchObject({
      identifierLike: true,
    });
    expect(
      describeStorageValue("fb.1.1764095412345.98765432101234567"),
    ).toMatchObject({
      identifierLike: true,
    });
    expect(describeStorageValue("Zx8aQ2mN7pL4vR9tK1cW3yB6")).toMatchObject({
      shape: "base64",
      identifierLike: true,
    });
    expect(
      describeStorageValue('{"visitorId":"a8f9c2e1b7d64f3a9e0c"}'),
    ).toMatchObject({ shape: "json", identifierLike: true });
  });
  test("decodes percent-encoding and never returns the value", () => {
    const signal = describeStorageValue("%7B%22theme%22%3A%22dark%22%7D");
    expect(signal).toEqual({
      length: "medium",
      shape: "json",
      identifierLike: false,
    });
  });
});
