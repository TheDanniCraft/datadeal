import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createReviewerWorkspace } from "./reviewer-source.ts";

const root = resolve(import.meta.dirname, "../..");
const outDir = join(import.meta.dirname, ".output");
const stage = await createReviewerWorkspace(root);
const previousDirectory = process.cwd();
try {
  execFileSync("bun", ["--no-env-file", "install", "--frozen-lockfile"], {
    cwd: stage.path,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, NODE_ENV: "development" },
  });
  process.env.NODE_ENV = "production";
  const stagedExtension = join(stage.path, "apps/extension");
  process.chdir(stagedExtension);
  // Resolve the builder from the same install as the browser runtime modules.
  const require = createRequire(join(stagedExtension, "package.json"));
  const { zip } = await import(pathToFileURL(require.resolve("wxt")).href);
  for (const browser of ["chrome", "firefox"])
    await zip({ root: stagedExtension, browser, outDir, mode: "production" });
} finally {
  process.chdir(previousDirectory);
  await stage.remove();
}
