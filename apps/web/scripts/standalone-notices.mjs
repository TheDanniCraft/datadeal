import { constants } from "node:fs";
import {
  copyFile,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const legalFile =
  /^(?:licen[cs]e|notice|copyright|copying|third[-_]party[-_]notices)(?:[-_.](?:apache(?:-?2\.0)?|mit|bsd|lesser|gpl|lgpl|notice))?(?:\.(?:txt|md))?$/i;

export async function preserveTracedNotices(
  checkout,
  standalone,
  directory,
  entries,
) {
  const parts = relative(standalone, directory).split(sep);
  const packageStart = parts.lastIndexOf("node_modules") + 1;
  const first = parts[packageStart];
  if (!packageStart || !first || first.startsWith(".")) return;
  const scoped = first.startsWith("@");
  if (scoped && !parts[packageStart + 1]) return;
  const nativeSharp =
    scoped &&
    first === "@img" &&
    parts.length === packageStart + 2 &&
    parts[packageStart + 1].startsWith("sharp-");

  // Match only directories genuinely present in Next's output. Package stores
  // may use links, so check the physical source location before reading it.
  const source = await realpath(resolve(checkout, ...parts));
  const within = relative(checkout, source);
  if (
    !within ||
    isAbsolute(within) ||
    within === ".." ||
    within.startsWith(".." + sep)
  )
    throw new Error(
      "Standalone notice directory is outside the checkout: " + parts.join("/"),
    );
  const present = new Set(entries.map((entry) => entry.name));
  const installed = await readdir(source, { withFileTypes: true });
  if (
    parts.length === packageStart + 1 &&
    ["pg-types", "pgpass"].includes(first) &&
    !installed.some((entry) => legalFile.test(entry.name)) &&
    !present.has("LICENSE")
  ) {
    // These two PostgreSQL packages put their complete MIT grants in their README.
    const readme = installed.find(
      (entry) => entry.name === "README.md" && entry.isFile(),
    );
    const text = readme && (await readFile(join(source, readme.name), "utf8"));
    const license = text
      ?.match(/^## License[^\S\r\n]*\r?\n([\s\S]*?)(?=^#|$(?![\s\S]))/im)?.[1]
      ?.trim();
    if (
      !license ||
      license.length > 3000 ||
      !license.includes("Copyright") ||
      !license.includes("Permission is hereby granted") ||
      !license.includes("THE SOFTWARE IS PROVIDED")
    )
      throw new Error("Review the installed README license for " + first);
    await writeFile(join(directory, "LICENSE"), license + "\n", { flag: "wx" });
  }
  for (const item of installed) {
    if (!item.isFile() || present.has(item.name)) continue;
    const chunk = item.name.replace(/\.LICENSE\.txt$/i, "");
    if (
      !legalFile.test(item.name) &&
      !(chunk !== item.name && present.has(chunk)) &&
      !(
        nativeSharp &&
        (item.name === "README.md" || item.name === "versions.json")
      )
    )
      continue;
    // The native sharp binary package lists embedded libraries and their
    // licenses in its README, separately from the addon’s Apache LICENSE.
    await copyFile(
      join(source, item.name),
      join(directory, item.name),
      constants.COPYFILE_EXCL,
    );
  }
}
