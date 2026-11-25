import { openAIAnalyzer } from "@datadeal/ai";
import { runWorker } from "./run";

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required");
await runWorker(openAIAnalyzer(apiKey, "gpt-5.4-mini-2026-03-17"), {
  requireBrowser: true,
});
