import {
  cp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { preserveTracedNotices } from "./standalone-notices.mjs";

const web = fileURLToPath(new URL("../", import.meta.url));
process.env.DATADEAL_STANDALONE = "true";
await import("./build.mjs");

const standalone = resolve(web, ".next/standalone");
const serverApp = resolve(standalone, "apps/web");
const tracingRoot = resolve(web, "../..");
const links = [];
function inside(directory, path) {
  const entry = relative(directory, path);
  return (
    entry !== "" &&
    entry !== ".." &&
    !entry.startsWith(".." + sep) &&
    !isAbsolute(entry)
  );
}
async function prepareRuntime(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await preserveTracedNotices(tracingRoot, standalone, directory, entries);
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (/^\.env(?:\.|$)/i.test(entry.name)) {
      if (entry.isDirectory())
        throw new Error(
          "A local environment directory was traced into the runtime",
        );
      await rm(path);
    } else if (
      /^local-(?:worker|browser-proxy|analysis-stream)\.[cm]?[jt]s$/i.test(
        entry.name,
      )
    )
      throw new Error("Development OAuth tooling was traced into the runtime");
    else if (entry.isSymbolicLink()) {
      const raw = await readlink(path);
      const actual = await realpath(path);
      if (!inside(standalone, actual) && !inside(tracingRoot, actual))
        throw new Error(
          "Traced link points outside the workspace: " +
            relative(standalone, path),
        );
      if (
        !isAbsolute(raw) &&
        inside(standalone, resolve(dirname(path), raw)) &&
        inside(standalone, actual)
      )
        continue;
      const target = inside(standalone, actual)
        ? actual
        : resolve(standalone, relative(tracingRoot, actual));
      if (!inside(standalone, await realpath(target)))
        throw new Error(
          "Traced package is missing from standalone output: " +
            relative(standalone, target),
        );
      links.push({
        path,
        target,
        directory: (await stat(target)).isDirectory(),
      });
    } else if (entry.isDirectory()) await prepareRuntime(path);
  }
}
await cp(resolve(web, "public"), resolve(serverApp, "public"), {
  recursive: true,
});
await cp(resolve(web, ".next/static"), resolve(serverApp, ".next/static"), {
  recursive: true,
});
await prepareRuntime(standalone);
const deferred = [];
for (const link of links) {
  await unlink(link.path);
  try {
    await symlink(
      relative(dirname(link.path), link.target),
      link.path,
      link.directory ? "dir" : "file",
    );
  } catch (error) {
    // Without Developer Mode, Windows can create only absolute junctions.
    // Ship the relative mapping and create the junction at its final location.
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    deferred.push({
      path: relative(standalone, link.path).split(sep).join("/"),
      target: relative(standalone, link.target).split(sep).join("/"),
    });
  }
}
if (deferred.length) {
  await writeFile(
    resolve(standalone, "package-links.json"),
    JSON.stringify(deferred),
  );
  await cp(
    new URL("./prepare-package-links.cjs", import.meta.url),
    resolve(standalone, "prepare-package-links.cjs"),
  );
  const server = resolve(serverApp, "server.js");
  const entry = await readFile(server, "utf8");
  await writeFile(
    server,
    'require("../../prepare-package-links.cjs");\n' + entry,
  );
}
console.log("Standalone web runtime ready in apps/web/.next/standalone");
