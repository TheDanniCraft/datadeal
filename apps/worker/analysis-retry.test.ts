import { describe, expect, it, vi } from "vitest";
import {
  AnalysisProviderError,
  AnalysisStreamError,
  type EvidenceAnalyzer,
} from "@datadeal/ai";
import { analysisFailure, analyzeWithRetry } from "./analysis-retry";

describe("worker analysis recovery", () => {
  it("renews the lease during a long offline analysis and stops on completion", async () => {
    vi.useFakeTimers();
    try {
      const renew = vi.fn(async () => true);
      let finish!: () => void;
      const inference = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const running = analyzeWithRetry(
        {
          model: "test",
          analyze: async () => {
            await inference;
            return { claims: [], findings: [] };
          },
        },
        [],
        renew,
        vi.fn(),
      );
      await vi.advanceTimersByTimeAsync(45_000);
      expect(renew).toHaveBeenCalledTimes(3);
      finish();
      await running;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(renew).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("renews ownership before replaying the same evidence once", async () => {
    const calls: string[] = [];
    const evidence: Parameters<EvidenceAnalyzer["analyze"]>[0] = [];
    const result = { findings: [], claims: [] };
    const analyze = vi.fn<EvidenceAnalyzer["analyze"]>(async (input) => {
      expect(input).toBe(evidence);
      calls.push("analyze");
      if (calls.length === 1)
        throw new AnalysisStreamError("stream_interrupted");
      return result;
    });
    const output = await analyzeWithRetry(
      { model: "test", analyze },
      evidence,
      async () => {
        calls.push("renew");
        return true;
      },
      (failure) => calls.push(failure.reason),
    );
    expect(calls).toEqual([
      "analyze",
      "renew",
      "stream_interrupted",
      "analyze",
    ]);
    expect(output).toBe(result);
  });

  it("stops after the second transient failure", async () => {
    const error = new AnalysisProviderError(503);
    const analyze = vi
      .fn<EvidenceAnalyzer["analyze"]>()
      .mockRejectedValue(error);
    await expect(
      analyzeWithRetry(
        { model: "test", analyze },
        [],
        async () => true,
        vi.fn(),
      ),
    ).rejects.toBe(error);
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it("sends no second request when the database lease has expired", async () => {
    const analyze = vi
      .fn<EvidenceAnalyzer["analyze"]>()
      .mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const retry = vi.fn();
    expect(
      await analyzeWithRetry(
        { model: "test", analyze },
        [],
        async () => false,
        retry,
      ),
    ).toBeUndefined();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it.each([
    new AnalysisProviderError(401),
    new AnalysisProviderError(402),
    new AnalysisProviderError(403),
    new AnalysisProviderError(429),
    new AnalysisStreamError("stream_failed"),
    new AnalysisStreamError("stream_incomplete"),
    new DOMException("cancelled", "AbortError"),
    new SyntaxError("invalid JSON including sensitive data"),
    new TypeError("bad input"),
  ])(
    "preserves terminal failures without scheduling another request",
    async (error) => {
      const analyze = vi
        .fn<EvidenceAnalyzer["analyze"]>()
        .mockRejectedValue(error);
      const renew = vi.fn(async () => true);
      await expect(
        analyzeWithRetry({ model: "test", analyze }, [], renew, vi.fn()),
      ).rejects.toBe(error);
      expect(analyze).toHaveBeenCalledTimes(1);
      expect(renew).not.toHaveBeenCalled();
    },
  );

  it("classifies transport codes without including error messages in diagnostics", () => {
    const cause = Object.assign(new Error("private endpoint"), {
      code: "ECONNRESET",
    });
    const failure = analysisFailure(new TypeError("fetch failed", { cause }));
    expect(failure).toEqual({ reason: "network", retryable: true });
  });
});
