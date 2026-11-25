import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "../app/api/local-origin/route";
import { proxy } from "../proxy";

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["localhost:3100", "POST", "text/html"],
  ["localhost:3100", "GET", "application/json"],
  ["localhost:3101", "GET", "text/html"],
  ["unrelated.example:3100", "GET", "text/html"],
  ["127.0.0.1:3100", "GET", "text/html"],
])("leaves %s %s %s alone", (host, method, accept) => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3100");
  expect(
    proxy(
      new NextRequest("http://" + host + "/account", {
        method,
        headers: { host, accept },
      }),
    ),
  ).toBeUndefined();
});

it("disables both halves of the local redirect in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3100");
  const req = new NextRequest("http://localhost:3100/account", {
    headers: { host: "localhost:3100", accept: "text/html" },
  });
  expect(proxy(req)).toBeUndefined();
  expect(GET(req).status).toBe(404);
});
