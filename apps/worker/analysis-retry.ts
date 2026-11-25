import { setTimeout as delay } from "node:timers/promises";
import {
  AnalysisProviderError,
  AnalysisStreamError,
  type EvidenceAnalyzer,
} from "@datadeal/ai";

const transientNetworkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function hasTransientNetworkCode(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    transientNetworkCodes.has(error.code)
  );
}

// Only these diagnostic fields may be logged. Provider messages can contain input.
export function analysisFailure(error: unknown): {
  reason: string;
  retryable: boolean;
  providerStatus?: number;
} {
  if (error instanceof AnalysisProviderError) {
    const { status } = error;
    return {
      reason:
        status === 401 || status === 403
          ? "provider_auth"
          : status === 402 || status === 429
            ? "provider_billing_or_limit"
            : "provider_http_error",
      providerStatus: status,
      retryable: [408, 500, 502, 503, 504].includes(status),
    };
  }
  if (error instanceof AnalysisStreamError)
    return {
      reason: error.reason,
      retryable: error.reason === "stream_interrupted",
    };
  if (error instanceof Error) {
    if (error.name === "TimeoutError")
      return { reason: "timeout", retryable: true };
    if (error.name === "AbortError")
      return { reason: "aborted", retryable: false };
    if (hasTransientNetworkCode(error) || hasTransientNetworkCode(error.cause))
      return { reason: "network", retryable: true };
    if (error instanceof SyntaxError)
      return { reason: "invalid_json", retryable: false };
    if (error.name === "ZodError")
      return { reason: "invalid_structure", retryable: false };
    if (error.message === "No analysis candidates passed validation")
      return { reason: "invalid_citations", retryable: false };
  }
  return { reason: "analysis_failed", retryable: false };
}

export async function analyzeWithRetry(
  analyzer: EvidenceAnalyzer,
  evidence: Parameters<EvidenceAnalyzer["analyze"]>[0],
  renewLease: () => Promise<boolean>,
  onRetry: (failure: ReturnType<typeof analysisFailure>) => void,
) {
  let ownsLease = true;
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing || !ownsLease) return;
    renewing = true;
    try {
      ownsLease = await renewLease();
    } catch {
      ownsLease = false;
    } finally {
      renewing = false;
    }
  }, 15000);
  heartbeat.unref();
  try {
    try {
      const result = await analyzer.analyze(evidence);
      return ownsLease ? result : undefined;
    } catch (error) {
      const failure = analysisFailure(error);
      if (!failure.retryable) throw error;
      await delay(500);
      if (!ownsLease || !(await renewLease())) return undefined;
      onRetry(failure);
      const result = await analyzer.analyze(evidence);
      return ownsLease ? result : undefined;
    }
  } finally {
    clearInterval(heartbeat);
  }
}
