import Anthropic from "@anthropic-ai/sdk";
import {
  AnalysisProviderError,
  completionAnalyzer,
  type Completion,
  type EvidenceAnalyzer,
} from "./index";

export type ClaudeEffort = "low" | "medium" | "high";

/**
 * Production transport: one Messages API request per analysis step, billed to
 * the Console organization that owns `apiKey`. Crawled text is passed only as
 * user content; the instructions stay in the system prompt.
 */
export function claudeCompletion(
  apiKey: string,
  model: string,
  effort: ClaudeEffort = "medium",
  transport?: { fetch?: typeof fetch; maxRetries?: number },
): Completion {
  const client = new Anthropic({
    apiKey,
    authToken: null,
    baseURL: "https://api.anthropic.com",
    maxRetries: transport?.maxRetries ?? 2,
    ...(transport?.fetch ? { fetch: transport.fetch } : {}),
  });
  return async (instructions, input, signal, maxOutputTokens) => {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: Math.max(maxOutputTokens, 1024),
          output_config: { effort },
          system: instructions,
          messages: [{ role: "user", content: input }],
        },
        { signal },
      );
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionError)
        throw new AnalysisProviderError(503);
      if (error instanceof Anthropic.APIError)
        throw new AnalysisProviderError(error.status ?? 500);
      throw error;
    }
    // A declined or truncated answer cannot be validated, so treat it as a
    // provider failure. The scan evidence is still published without it.
    if (response.stop_reason === "refusal")
      throw new AnalysisProviderError(422);
    if (response.stop_reason === "max_tokens")
      throw new AnalysisProviderError(413);
    return response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
  };
}

export function claudeAnalyzer(
  apiKey: string,
  model: string,
  effort?: ClaudeEffort,
): EvidenceAnalyzer {
  return completionAnalyzer(model, claudeCompletion(apiKey, model, effort));
}
