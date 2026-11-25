import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise Docker's real ignore precedence without sending the repository to Docker.
const repository = fileURLToPath(new URL("../", import.meta.url));
const shared = [
  "package.json",
  "bun.lock",
  "apps/web/package.json",
  "packages/contracts/index.ts",
];
const web = [
  "apps/web/app/report/[domain]/page.tsx",
  "apps/web/app/api/v1/reports/[domain]/route.ts",
  "apps/web/lib/ads/visitor.ts",
  "apps/web/public/favicons/bild.png",
];
const worker = [
  "apps/worker/index.ts",
  "apps/worker/browser-egress.mts",
  "packages/database/compose-migrate.mjs",
  "packages/database/migrations/9999_fixture.sql",
];
const excluded = [
  ".env.production",
  "apps/web/.env.local",
  "packages/database/.env",
  "apps/web/node_modules/@heroui-pro/react/index.js",
  "apps/web/app/report/[domain]/node_modules/vendor/index.ts",
  "apps/web/app/report/[domain]/.next/server/route.ts",
  "apps/web/lib/ads/test-results/trace.ts",
  "apps/web/lib/cache/compiled.ts",
  "apps/web/lib/private-key.ts",
  "apps/web/public/unreviewed.json",
  "apps/worker/scan.test.ts",
  "apps/worker/tmp/fixture.ts",
  "packages/database/migrations/backup.sql",
  "tools/local-worker.mts",
];

async function listFiles(base, prefix = "") {
  const paths = [];
  for (const entry of await readdir(join(base, prefix), {
    withFileTypes: true,
  })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...(await listFiles(base, relative)));
    else paths.push(relative);
  }
  return paths.sort();
}

const endpoint =
  process.env.DOCKER_HOST ||
  (process.platform === "win32"
    ? "npipe:////./pipe/dockerDesktopLinuxEngine"
    : execFileSync(
        "docker",
        ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
        { encoding: "utf8" },
      ).trim());
assert.match(
  endpoint,
  /^(?:unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/)/i,
  "Use a local Docker socket or named pipe.",
);
const env = { ...process.env, DOCKER_BUILDKIT: "1" };
for (const key of ["DOCKER_CONTEXT", "BUILDX_BUILDER", "BUILDKIT_HOST"])
  delete env[key];
const tempBase = resolve(tmpdir());
const temporary = await mkdtemp(join(tempBase, "datadeal-context-"));
try {
  const mirror = join(temporary, "mirror");
  for (const path of [...shared, ...web, ...worker, ...excluded]) {
    const file = join(mirror, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "synthetic fixture\n");
  }
  await mkdir(join(mirror, "deploy"));
  for (const path of [
    ".dockerignore",
    "deploy/worker.Dockerfile.dockerignore",
  ]) {
    await copyFile(join(repository, path), join(mirror, path));
  }
  for (const [target, required] of [
    ["web", web],
    ["worker", worker],
  ]) {
    const dockerfile = join(mirror, "deploy", `${target}.Dockerfile`);
    const output = join(temporary, target);
    await writeFile(dockerfile, "FROM scratch\nCOPY . /\n");
    execFileSync(
      "docker",
      [
        "--host",
        endpoint,
        "build",
        "--builder",
        "default",
        "--network",
        "none",
        "-f",
        dockerfile,
        "--output",
        `type=local,dest=${output}`,
        mirror,
      ],
      { env },
    );
    assert.deepEqual(
      await listFiles(output),
      [...shared, ...required].sort(),
      `${target} context contents`,
    );
    console.log(
      `${target} context passed (${shared.length + required.length} expected files).`,
    );
  }
} finally {
  assert.equal(dirname(temporary), tempBase);
  await rm(temporary, { recursive: true, force: true });
}
