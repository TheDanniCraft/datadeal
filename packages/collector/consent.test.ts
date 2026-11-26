import { describe, expect, it } from "vitest";
import { otherConsentControl, rejectName, shortAcceptAllName } from "./consent";

describe("consent controls", () => {
  it("recognises the reject button next to a short Accept all", () => {
    for (const label of [
      "Reject Optional Cookies",
      "Optionale Cookies ablehnen",
      "Alle ablehnen",
      "Einstellungen",
      "Manage preferences",
    ])
      expect(otherConsentControl.test(label), label).toBe(true);
  });

  it("does not take ordinary page buttons for banner controls", () => {
    for (const label of ["Open menu", "Log in", "Alle akzeptieren", "Share"])
      expect(otherConsentControl.test(label), label).toBe(false);
  });

  it("matches Reddit's banner in English and German", () => {
    expect(shortAcceptAllName.test("Accept All")).toBe(true);
    expect(shortAcceptAllName.test("Alle akzeptieren")).toBe(true);
    expect(rejectName.test("Reject Optional Cookies")).toBe(true);
    expect(rejectName.test("Optionale Cookies ablehnen")).toBe(true);
  });
});
