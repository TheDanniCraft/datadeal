// Copied into a standalone runtime when the build host cannot create relative links.
const {
  copyFileSync,
  constants,
  lstatSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
} = require("node:fs");
const { dirname, isAbsolute, relative, resolve, sep } = require("node:path");
const root = realpathSync(__dirname);
function local(path) {
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Invalid standalone dependency path");
  return path;
}
for (const item of require("./package-links.json")) {
  const link = local(resolve(root, item.path));
  if (dirname(link) !== root) local(realpathSync(dirname(link)));
  const target = local(realpathSync(resolve(root, item.target)));
  const existing = lstatSync(link, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isSymbolicLink()) {
      // A relative file link can be materialized as a regular file on Windows.
      if (existing.isFile() && statSync(target).isFile()) continue;
      throw new Error("Expected a package link at " + item.path);
    }
    let actual;
    try {
      actual = realpathSync(link);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (actual === target) continue;
    unlinkSync(link);
  }
  const directory = statSync(target).isDirectory();
  try {
    if (process.platform === "win32") {
      if (directory) symlinkSync(target, link, "junction");
      else copyFileSync(target, link, constants.COPYFILE_EXCL);
    } else
      symlinkSync(
        relative(dirname(link), target),
        link,
        directory ? "dir" : "file",
      );
  } catch (error) {
    if (error.code !== "EEXIST" || realpathSync(link) !== target) throw error;
  }
}
