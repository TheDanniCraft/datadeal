import { describe, expect, it } from "vitest";
import { readAnalysisStream } from "./local-analysis-stream";

function events(...data: unknown[]) {
  return new Response(
    data.map((item) => "data: " + JSON.stringify(item) + "\r\n\r\n").join(""),
  );
}

describe("development analysis stream", () => {
  it("publishes output only after a completion event", async () => {
    const part = { type: "response.output_text.delta", delta: "result" };
    await expect(readAnalysisStream(events(part))).rejects.toMatchObject({
      reason: "stream_interrupted",
    });
    await expect(
      readAnalysisStream(events(part, { type: "response.completed" })),
    ).resolves.toBe("result");
  });

  it("recognizes quota exhaustion inside a successful HTTP stream", async () => {
    const failure = events({
      type: "response.failed",
      response: {
        error: {
          code: "insufficient_quota",
          message: "private provider content",
        },
      },
    });
    await expect(readAnalysisStream(failure)).rejects.toMatchObject({
      status: 429,
      message: "Evidence analysis provider returned HTTP 429",
    });
  });
});
