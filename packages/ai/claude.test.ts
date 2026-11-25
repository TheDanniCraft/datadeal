import { expect, test } from "vitest";
import { AnalysisProviderError, claudeCompletion, jsonOutput } from "./index";

function reply(body: object, status = 200) {
  const calls: { url: string; body: any; headers: Headers }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const message = (stop_reason: string, text = '{"ok":true}') => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

test("sends instructions as system and evidence as user content", async () => {
  const { fetch, calls } = reply(message("end_turn"));
  const complete = claudeCompletion("test-key", "claude-opus-5-5", "low", {
    fetch,
    maxRetries: 0,
  });
  const text = await complete(
    "Classify.",
    "<evidence/>",
    AbortSignal.timeout(5000),
    800,
  );
  expect(text).toBe('{"ok":true}');
  expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
  expect(
    calls[0].headers.get("x-api-key") ?? calls[0].headers.get("authorization"),
  ).toMatch(/^(Bearer )?test-key$/);
  expect(calls[0].body).toMatchObject({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    system: "Classify.",
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "<evidence/>" }],
  });
});

test("treats refusals and truncation as provider failures", async () => {
  for (const [stop, status] of [
    ["refusal", 422],
    ["max_tokens", 413],
  ] as const) {
    const { fetch } = reply(message(stop));
    const complete = claudeCompletion("k", "m", "low", {
      fetch,
      maxRetries: 0,
    });
    const result = complete("i", "x", AbortSignal.timeout(5000), 100);
    await expect(result).rejects.toBeInstanceOf(AnalysisProviderError);
    await expect(result).rejects.toMatchObject({ status });
  }
});

test("maps API errors to provider status codes", async () => {
  const { fetch } = reply(
    { type: "error", error: { type: "rate_limit_error", message: "slow" } },
    429,
  );
  const complete = claudeCompletion("k", "m", "low", { fetch, maxRetries: 0 });
  await expect(
    complete("i", "x", AbortSignal.timeout(5000), 100),
  ).rejects.toMatchObject({ status: 429 });
});

test("parses JSON wrapped in a Markdown fence", () => {
  expect(jsonOutput('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(jsonOutput(' {"a":2} ')).toEqual({ a: 2 });
  expect(() => jsonOutput("no json")).toThrow();
});
