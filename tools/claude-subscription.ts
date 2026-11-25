import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  AnalysisProviderError,
  completionAnalyzer,
  type ClaudeEffort,
  type Completion,
} from "../packages/ai/index";

/**
 * Local development transport. Runs one Claude Code turn with no tools, MCP
 * servers or settings, so it behaves like a single classification request.
 * Usage is drawn from the developer's Claude subscription through the token
 * created by `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN). Never use this
 * for production traffic or for requests on behalf of other people.
 */
export function subscriptionCompletion(
  model: string,
  effort: ClaudeEffort = "medium",
): Completion {
  // A token copied from a wrapped terminal line can contain spaces.
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.replace(/\s+/g, "");
  if (!token)
    throw new Error(
      "CLAUDE_CODE_OAUTH_TOKEN is required. Run `claude setup-token` and add it to the root .env.",
    );
  return async (instructions, input, signal) => {
    const abortController = new AbortController();
    const abort = () => abortController.abort(signal.reason);
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      for await (const message of query({
        prompt: input,
        options: {
          model,
          effort,
          systemPrompt: instructions,
          tools: [],
          maxTurns: 1,
          settingSources: [],
          mcpServers: {},
          strictMcpConfig: true,
          persistSession: false,
          abortController,
          // Only the subscription token: no API key, base URL or settings
          // from a surrounding Claude Code session may reach the child.
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) => !/^(?:CLAUDE|ANTHROPIC)/.test(key),
              ),
            ),
            CLAUDE_CODE_OAUTH_TOKEN: token,
          },
        },
      })) {
        if (message.type !== "result") continue;
        if (message.subtype === "success" && !message.is_error) {
          // Development only: keep raw responses to debug parsing.
          const dir = process.env.DATADEAL_DEBUG_AI_DIR;
          if (dir)
            await writeFile(
              join(dir, `${Date.now()}-${message.stop_reason ?? "end"}.txt`),
              message.result,
            ).catch(() => undefined);
          return message.result;
        }
        const errors = "errors" in message ? message.errors.join(" ") : "";
        console.warn(
          JSON.stringify({
            event: "subscription_result_error",
            subtype: message.subtype,
            errors: errors.slice(0, 300),
          }),
        );
        throw new AnalysisProviderError(
          /rate|limit|usage/i.test(errors) ? 429 : 500,
        );
      }
      throw new AnalysisProviderError(500);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
}

export function subscriptionAnalyzer(model: string, effort?: ClaudeEffort) {
  return completionAnalyzer(
    model + " (Claude subscription)",
    subscriptionCompletion(model, effort),
  );
}
