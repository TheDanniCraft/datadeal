import {
  AnalysisProviderError,
  AnalysisStreamError,
} from "../packages/ai/index";

export async function readAnalysisStream(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AnalysisProviderError(response.status);
  }
  if (!response.body) throw new AnalysisStreamError("stream_interrupted");
  let pending = "";
  let output = "";
  for await (const chunk of response.body.pipeThrough(
    new TextDecoderStream(),
  )) {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      if (
        event.type === "response.output_text.delta" &&
        typeof event.delta === "string"
      )
        output += event.delta;
      if (event.type === "response.completed") return output;
      if (event.type === "response.incomplete")
        throw new AnalysisStreamError("stream_incomplete");
      if (event.type !== "response.failed" && event.type !== "error") continue;
      const code =
        event.response?.error?.code ?? event.error?.code ?? event.code;
      switch (code) {
        case "server_error":
          throw new AnalysisProviderError(500);
        case "insufficient_quota":
        case "rate_limit_exceeded":
          throw new AnalysisProviderError(429);
        case "invalid_api_key":
          throw new AnalysisProviderError(401);
        default:
          throw new AnalysisStreamError("stream_failed");
      }
    }
  }
  throw new AnalysisStreamError("stream_interrupted");
}
