import { execFileSync } from "node:child_process";
import {
  copyFile,
  glob,
  mkdir,
  mkdtempDisposable,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

export const sourcePatterns = [
  "apps/extension/entrypoints/**",
  "apps/extension/lib/**",
  "apps/extension/public/icon/*.png",
  "apps/extension/public/licenses/*.txt",
  "apps/extension/public/THIRD-PARTY-NOTICES.md",
  "apps/extension/SUBMISSION.md",
  "apps/extension/package.json",
  "apps/extension/package-release.mts",
  "apps/extension/postcss.config.mjs",
  "apps/extension/reviewer-source.ts",
  "apps/extension/tsconfig.json",
  "apps/extension/wxt.config.ts",
  "apps/web/app/fonts/Inter.ttf",
  "apps/web/app/fonts/Inter-OFL.txt",
  "packages/ui/mouve.css",
  "packages/contracts/*.ts",
  "packages/contracts/package.json",
  "packages/contracts/tsconfig.json",
  "package.json",
  "bun.lock",
  "tsconfig.base.json",
];

export async function createReviewerWorkspace(root: string) {
  const stage = await mkdtempDisposable(
    join(tmpdir(), "datadeal-extension-review-"),
  );
  try {
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    for await (const entry of glob(sourcePatterns, {
      cwd: root,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(entry.name))
        continue;
      const source = join(entry.parentPath, entry.name);
      const target = join(stage.path, relative(root, source));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    await writeFile(
      join(stage.path, "package.json"),
      JSON.stringify(
        {
          name: manifest.name,
          private: true,
          packageManager: manifest.packageManager,
          workspaces: ["apps/extension", "packages/contracts"],
          devDependencies: {
            "@types/node": manifest.devDependencies["@types/node"],
            typescript: manifest.devDependencies.typescript,
          },
          trustedDependencies: ["esbuild"],
        },
        null,
        2,
      ) + "\n",
    );
    // Let Bun project the full dependency graph onto these two workspaces.
    // Offline lockfile-only mode preserves the versions selected for the release.
    execFileSync(
      "bun",
      [
        "--no-env-file",
        "install",
        "--lockfile-only",
        "--offline",
        "--ignore-scripts",
      ],
      {
        cwd: stage.path,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    return stage;
  } catch (error) {
    await stage.remove();
    throw error;
  }
}
