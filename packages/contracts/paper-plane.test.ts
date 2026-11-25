import { expect, it } from "vitest";
import {
  drawFlightEndpoint,
  flightTimeMs,
  liveOffer,
  resolveFlight,
  survivalProbability,
} from "./paper-plane";

it("uses the published success curve for a fixed target", () => {
  expect(survivalProbability(1)).toBe(1);
  expect(survivalProbability(50)).toBeCloseTo(0.64515, 4);
  expect(drawFlightEndpoint(survivalProbability(200))).toBeCloseTo(200, 9);
});
it("banks one target before a later crash, including when the player reconnects", () => {
  expect(resolveFlight({ endpoint: 236, target: 81, activeMs: 30000 })).toEqual(
    { state: "banked", points: 81 },
  );
  expect(
    resolveFlight({ endpoint: 81, target: 81, activeMs: 30000, collect: true }),
  ).toEqual({ state: "missed", points: 0 });
  expect(resolveFlight({ endpoint: 1000.1, activeMs: 30000 })).toEqual({
    state: "banked",
    points: 1000,
  });
});
it("allows a manual collect only for the live offer before its endpoint", () => {
  expect(liveOffer(flightTimeMs(36))).toBe(36);
  expect(
    resolveFlight({
      endpoint: 36.5,
      activeMs: flightTimeMs(36),
      collect: true,
    }),
  ).toEqual({ state: "banked", points: 36 });
  expect(
    resolveFlight({
      endpoint: 36.5,
      activeMs: flightTimeMs(36.5),
      collect: true,
    }),
  ).toEqual({ state: "missed", points: 0 });
});
