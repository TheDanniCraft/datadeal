import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("recreates deferred package links inside the standalone directory after a move", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "datadeal-standalone-test-"));
  const original = join(scratch, "build");
  const moved = join(scratch, "release");
  try {
    await mkdir(join(original, "modules", "library"), { recursive: true });
    await mkdir(join(original, "app", "node_modules"), { recursive: true });
    const links = [
      { path: "app/node_modules/library", target: "modules/library" },
    ];
    await writeFile(
      join(original, "package-links.json"),
      JSON.stringify(links),
    );
    await cp(
      new URL("./prepare-package-links.cjs", import.meta.url),
      join(original, "prepare-package-links.cjs"),
    );
    async function verify(root: string) {
      execFileSync(process.execPath, ["prepare-package-links.cjs"], {
        cwd: root,
        windowsHide: true,
      });
      expect(await realpath(join(root, links[0]!.path))).toBe(
        await realpath(join(root, links[0]!.target)),
      );
    }
    await verify(original);
    await rename(original, moved);
    await verify(moved);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
