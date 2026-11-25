import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { preserveTracedNotices } from "./standalone-notices.mjs";

it("keeps package notices and native binary attributions without copying untraced code", async () => {
  const checkout = await mkdtemp(join(tmpdir(), "datadeal-notices-"));
  try {
    const standalone = join(checkout, "build");
    const name = join("node_modules", "@img", "sharp-win32-x64");
    const input = join(checkout, name);
    const output = join(standalone, name);
    await mkdir(input, { recursive: true });
    await mkdir(output, { recursive: true });
    for (const file of [
      "LICENSE",
      "NOTICE",
      "README.md",
      "versions.json",
      "license.js",
      ".env",
      "unused.js.LICENSE.txt",
      "bundle.js.LICENSE.txt",
    ])
      await writeFile(join(input, file), file);
    await writeFile(join(output, "bundle.js"), "bundled runtime");
    async function collect() {
      await preserveTracedNotices(
        checkout,
        standalone,
        output,
        await readdir(output, { withFileTypes: true }),
      );
    }
    await collect();
    await collect();
    expect((await readdir(output)).sort()).toEqual(
      [
        "LICENSE",
        "NOTICE",
        "README.md",
        "versions.json",
        "bundle.js",
        "bundle.js.LICENSE.txt",
      ].sort(),
    );
    expect(await readFile(join(output, "NOTICE"), "utf8")).toBe("NOTICE");
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
});

it("refuses a source package link outside the checkout", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "datadeal-notice-boundary-"));
  try {
    const checkout = join(fixture, "checkout");
    const outside = join(fixture, "outside");
    const standalone = join(checkout, "build");
    const source = join(checkout, "node_modules");
    const output = join(standalone, "node_modules", "fixture");
    await mkdir(source, { recursive: true });
    await mkdir(output, { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "LICENSE"), "outside source");
    await symlink(
      outside,
      join(source, "fixture"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      preserveTracedNotices(checkout, standalone, output, []),
    ).rejects.toThrow("outside the checkout");
    expect(await readdir(output)).toEqual([]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
