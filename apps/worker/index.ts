import { claudeAnalyzer, type ClaudeEffort } from "@datadeal/ai";
import { runWorker } from "./run";

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
const model = process.env.DATADEAL_CLAUDE_MODEL?.trim() || "claude-opus-5-5";
const effort = (process.env.DATADEAL_CLAUDE_EFFORT?.trim() ||
  "medium") as ClaudeEffort;
if (!["low", "medium", "high"].includes(effort))
  throw new Error("DATADEAL_CLAUDE_EFFORT must be low, medium or high");
await runWorker(claudeAnalyzer(apiKey, model, effort), {
  requireBrowser: true,
});
