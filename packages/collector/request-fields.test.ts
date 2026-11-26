import type { Request } from "playwright";
import { expect, it } from "vitest";
import { requestFieldCollector } from "./request-fields";

it("recognizes a Permutive visitor and event only in the same record at a documented endpoint", () => {
  const event = {
    name: "PrivateAction",
    user_id: "8c4d2507-9f6c-4d21-bc9a-0b056db7d8cc",
    properties: {},
  };
  const origin = "https://api.permutive.app";
  function capture(url: string, payload: unknown) {
    const collector = requestFieldCollector(new URL("https://example.org"));
    const request = {
      url: () => url,
      method: () => "POST",
      headers: () => ({ "content-type": "application/json" }),
      postDataBuffer: () => Buffer.from(JSON.stringify(payload)),
    } as unknown as Request;
    collector.request(request, "after_choice");
    collector.response(request);
    return collector.results();
  }
  for (const [path, payload] of [
    ["/v2.0/events", event],
    ["/v2.0/batch/events", [event]],
  ] as const) {
    const groups = capture(origin + path, payload);
    expect(groups).toEqual([
      expect.objectContaining({
        signature: "permutive_event",
        targetDomain: "permutive.app",
        responses: 1,
        fieldCategories: ["event_name", "identifier"],
      }),
    ]);
    expect(JSON.stringify(groups)).not.toContain(event.user_id);
    expect(JSON.stringify(groups)).not.toContain(event.name);
  }
  for (const [url, payload] of [
    [origin + "/v2.0/identify", event],
    ["https://unrelated.net/v2.0/events", event],
    [origin + "/v2.0/events", { ...event, user_id: "missing" }],
    [origin + "/v2.0/events", { ...event, name: " " }],
    [
      origin + "/v2.0/batch/events",
      [{ name: event.name, properties: {} }, { user_id: event.user_id }],
    ],
  ] as const)
    expect(
      capture(url, payload).every(
        (group) =>
          !group.signature && !group.fieldCategories.includes("event_name"),
      ),
    ).toBe(true);
});

it("ties a whole email-shaped value to its own email field and discards the address", () => {
  const collector = requestFieldCollector(new URL("https://example.com"));
  for (const query of [
    "email=user%40example.org",
    "email=contact&other=user%40example.org",
    "email=write+to+user%40example.org",
  ]) {
    collector.request(
      {
        url: () => "https://example.net/event?" + query,
        method: () => "GET",
      } as Request,
      "after_choice",
    );
  }
  expect(
    collector
      .results()
      .map(({ attempts, fieldCategories }) => ({ attempts, fieldCategories })),
  ).toEqual([
    {
      attempts: 1,
      fieldCategories: ["email", "email_address_value", "email_value"],
    },
    { attempts: 2, fieldCategories: ["email", "email_value"] },
  ]);
  expect(JSON.stringify(collector.results())).not.toContain("user@example.org");
});

it("keeps private-suffix tenants distinct and only records populated advertising fields", () => {
  const collector = requestFieldCollector(
    new URL("https://news.github.io/story"),
  );
  for (const url of [
    "https://cdn.news.github.io/event?gclid=first",
    "https://other.github.io/event?gclid=second",
    "https://irrelevant.net/event?gclid=",
  ]) {
    const request = { url: () => url, method: () => "GET" } as Request;
    collector.request(request, "before_choice");
    collector.response(request);
  }
  expect(collector.results()).toEqual([
    expect.objectContaining({
      targetDomain: "news.github.io",
      relation: "same_site",
      fieldCategories: ["advertising_id"],
      responses: 1,
    }),
    expect.objectContaining({
      targetDomain: "other.github.io",
      relation: "cross_site",
      fieldCategories: ["advertising_id"],
      responses: 1,
    }),
  ]);
  const unknownSite = requestFieldCollector(
    new URL("https://unknown.invalid/story"),
  );
  unknownSite.request(
    {
      url: () => "https://example.org/?gclid=record",
      method: () => "GET",
    } as Request,
    "before_choice",
  );
  expect(unknownSite.results()).toEqual([]);
});

it("preserves late answered signals and examines post-click requests even after the pre-click budget fills", () => {
  const collector = requestFieldCollector(new URL("https://example.org"));
  function record(url: string, phase: "before_choice" | "after_choice") {
    const request = { url: () => url, method: () => "GET" } as Request;
    collector.request(request, phase);
    collector.response(request);
  }
  for (let i = 0; i < 513; i++)
    record("https://service" + i + ".com/?language=en", "before_choice");
  record("https://events.example.net/?gclid=private", "after_choice");
  expect(collector.results()).toHaveLength(24);
  expect(collector.results()).toContainEqual(
    expect.objectContaining({
      phase: "after_choice",
      fieldCategories: ["advertising_id"],
      responses: 1,
    }),
  );
  expect(collector.inspection()).toEqual({
    examined: 513,
    matched: 513,
    limitReached: true,
  });
  expect(JSON.stringify(collector.results())).not.toContain("private");
});
