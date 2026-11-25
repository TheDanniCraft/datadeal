// Run with prebuilt local images: node e2e/compose-smoke.mjs [--worker-only]
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const workerOnly = process.argv[2] === "--worker-only";
if (process.argv.length !== (workerOnly ? 3 : 2))
  throw new Error("Usage: node e2e/compose-smoke.mjs [--worker-only]");
const project = "datadeal-smoke-" + randomUUID();
const host = "compose-smoke.example";
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(path|pathext|systemroot|comspec|windir|temp|tmp|home|userprofile|homedrive|homepath|appdata|localappdata|programfiles|programdata|xdg_runtime_dir)$/i.test(
      key,
    ),
  ),
);
const secret = () => randomBytes(32).toString("hex");
const synthetic = {
  DATADEAL_DB_ADMIN_PASSWORD: secret(),
  DATADEAL_DB_PASSWORD: secret(),
  BETTER_AUTH_SECRET: secret(),
  DATADEAL_SCAN_LIMIT_SECRET: secret(),
  OPENAI_API_KEY: "unused-" + secret(),
};
function check(condition, message) {
  if (!condition) throw new Error(message);
}
function docker(args) {
  const run = spawnSync("docker", args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
  });
  // Docker output can contain interpolated secrets. Keep failure messages narrow.
  if (run.status !== 0) {
    const action = args.includes("--env-file")
      ? "compose " + args[args.indexOf("--env-file") + 2]
      : args[0] === "--context"
        ? args[2]
        : args[0];
    throw new Error(
      `Docker ${action} failed (${run.error?.code ?? run.status})`,
    );
  }
  return run.stdout.trim();
}
const context = docker(["context", "show"]);
const endpoint = JSON.parse(docker(["context", "inspect", context]))[0]
  .Endpoints.docker.Host;
check(/^(unix|npipe):\/\//.test(endpoint), "A local Docker socket is required");
const local = (...args) => docker(["--context", context, ...args]);
const temp = mkdtempSync(join(tmpdir(), "datadeal-compose-smoke-"));
const envFile = join(temp, "smoke.env");
const compose = (...args) =>
  local(
    "compose",
    "-f",
    "compose.yaml",
    "--project-name",
    project,
    "--env-file",
    envFile,
    ...args,
  );
function inspect(service) {
  const id = compose("ps", "--all", "--quiet", service);
  check(/^[a-f0-9]{12,64}$/.test(id), service + " container is missing");
  const container = JSON.parse(local("inspect", id))[0];
  check(
    container.Config.Labels["com.docker.compose.project"] === project,
    "Unexpected container owner",
  );
  return container;
}
async function until(checkState, message) {
  const expires = Date.now() + 75_000;
  while (Date.now() < expires) {
    if (await checkState()) return;
    await delay(1200);
  }
  throw new Error(message);
}
const appSql = (statement) =>
  compose(
    "exec",
    "-T",
    "database",
    "sh",
    "-ec",
    'export PGPASSWORD="$DATADEAL_DB_PASSWORD"; exec psql -XqtA -h 127.0.0.1 -U datadeal_app -d datadeal -v ON_ERROR_STOP=1 -c "$1"',
    "sh",
    statement,
  );
const adminSql = (statement) =>
  compose(
    "exec",
    "-T",
    "database",
    "psql",
    "-XqtA",
    "-U",
    "postgres",
    "-d",
    "datadeal",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  );
const workerReady = (minimum) =>
  until(() => {
    const logs = compose("logs", "--no-log-prefix", "worker");
    return (
      logs
        .split("\n")
        .filter(
          (line) =>
            line.includes('"event":"worker_ready"') &&
            line.includes('"browserCoverage":"all_public_domains"'),
        ).length >= minimum
    );
  }, "Worker did not finish PostgreSQL and sandboxed Chromium preflight");

function verifyIsolation() {
  const topology = {
    database: ["storage"],
    migrate: ["storage"],
    worker: ["storage", "browser", "worker-outbound"],
    "browser-egress": ["browser", "proxy-outbound"],
    ...(!workerOnly && { web: ["storage", "web-outbound"] }),
  };
  const privateNetworks = new Set(["storage", "browser"]);
  for (const name of new Set(Object.values(topology).flat())) {
    const network = JSON.parse(
      local("network", "inspect", project + "_" + name),
    )[0];
    check(
      network.Internal === privateNetworks.has(name),
      "Wrong isolation on network " + name,
    );
  }
  const secretOwners = {
    DATADEAL_DB_ADMIN_PASSWORD: ["database", "migrate"],
    DATADEAL_DB_PASSWORD: ["database", "worker", "web"],
    BETTER_AUTH_SECRET: ["web"],
    DATADEAL_SCAN_LIMIT_SECRET: ["web"],
    OPENAI_API_KEY: ["worker"],
  };
  for (const [service, networks] of Object.entries(topology)) {
    const { Config, HostConfig, NetworkSettings } = inspect(service);
    check(
      service === "database" ||
        (Config.User && !["0", "root"].includes(Config.User)),
      service + " runs as root",
    );
    const env = Config.Env ?? [];
    for (const [key, owners] of Object.entries(secretOwners)) {
      check(
        env.some((x) => x.endsWith("=" + synthetic[key])) ===
          owners.includes(service),
        "Wrong " + key + " scope on " + service,
      );
    }
    check(
      !env.some((x) => /^(HEROUI_|DATADEAL_LOCAL_|CHATGPT_)/.test(x)),
      "Build or development variable present on " + service,
    );
    if (service !== "web") {
      check(
        !env.some((x) => /^(CREEM_|RESEND_API_KEY=)/.test(x)),
        "Billing or mail settings present on " + service,
      );
      check(
        Object.keys(HostConfig.PortBindings ?? {}).length === 0,
        "Private service publishes a port: " + service,
      );
    }
    // Docker may detach a completed one-shot migrator from its network.
    const attached = Object.keys(NetworkSettings.Networks);
    if (service !== "migrate" || attached.length)
      check(
        attached.sort().join() ===
          networks
            .map((n) => project + "_" + n)
            .sort()
            .join(),
        "Unexpected network attached to " + service,
      );
  }
  compose(
    "exec",
    "-T",
    "worker",
    "node",
    "-e",
    "fetch('http://browser-egress:8080/healthz',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.status===204?0:1)).catch(()=>process.exit(1))",
  );
  for (const [service, name] of [
    ["browser-egress", "database"],
    ...(!workerOnly ? [["web", "browser-egress"]] : []),
  ]) {
    compose(
      "exec",
      "-T",
      service,
      "node",
      "-e",
      "require('node:dns').lookup(process.argv[1],(e)=>process.exit(e?.code==='ENOTFOUND'||e?.code==='EAI_AGAIN'?0:1))",
      name,
    );
  }
}

async function verifyWeb() {
  const binding = compose("port", "web", "3000");
  check(
    /^127\.0\.0\.1:\d+$/.test(binding),
    "Web must publish only a loopback port",
  );
  const base = "http://" + binding;
  await until(async () => {
    try {
      const r = await fetch(base + "/api/ready", {
        signal: AbortSignal.timeout(2500),
      });
      return r.ok && (await r.json()).ready === true;
    } catch {
      return false;
    }
  }, "Web readiness failed");
  const get = async (path) => {
    const r = await fetch(base + path, {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    check(r.status === 200, "Unexpected HTTP " + r.status + " on " + path);
    return r;
  };
  const data = await (await get("/api/v1/domains/" + host)).json();
  check(
    data.domain === host && data.state === null && data.report === null,
    "Free report API should return a genuine empty state",
  );
  const report = await (await get("/report/" + host)).text();
  check(
    report.includes(host) && report.includes("No report available"),
    "Report page did not show the empty report",
  );
  const prices = await (await get("/pricing")).text();
  check(
    prices.includes("Free") &&
      prices.includes("Pro") &&
      prices.includes("One-domain unlock"),
    "Pricing tiers are missing",
  );
  const asset = "/_next/static/licenses/third-party-notices.txt";
  check(
    (await (await get("/terms")).text()).includes(asset),
    "Terms do not link the compiled notices",
  );
  check(
    (await (await get(asset)).text()).includes("Apache License"),
    "Compiled notices are missing",
  );
}

try {
  const testConfig = {
    ...synthetic,
    APP_ORIGIN: "https://compose-smoke.example",
    DATADEAL_WEB_PORT: "0",
  };
  writeFileSync(
    envFile,
    Object.entries(testConfig)
      .map(([key, value]) => key + "=" + value)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  console.log("Starting disposable Compose project " + project);
  compose(
    "up",
    "-d",
    "--no-build",
    "--pull",
    "never",
    ...(workerOnly ? ["worker"] : []),
  );
  await workerReady(1);
  check(inspect("migrate").State.ExitCode === 0, "Migrations failed");
  const count = readdirSync(join(root, "packages/database/migrations")).filter(
    (name) => /^\d{4}_.+\.sql$/.test(name),
  ).length;
  check(
    adminSql("SELECT count(*) FROM datadeal_schema_migrations") ===
      String(count),
    "Migration ledger is incomplete",
  );
  check(
    appSql(
      "SELECT current_user, rolsuper, rolcreaterole, rolcreatedb, has_schema_privilege(current_user,'public','CREATE'), has_table_privilege(current_user,'datadeal_schema_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') FROM pg_roles WHERE rolname = current_user",
    ) === "datadeal_app|f|f|f|f|f",
    "Application role can administer storage or the migration ledger",
  );
  check(
    adminSql(
      "SELECT current_user, rolsuper FROM pg_roles WHERE rolname=current_user",
    ) === "postgres|t",
    "Migration admin role is missing",
  );
  check(
    appSql("SELECT count(*) FROM scan_jobs") === "0",
    "Queue was not empty",
  );
  verifyIsolation();
  if (!workerOnly) await verifyWeb();
  console.log(
    "Startup, " +
      count +
      " migrations, worker readiness and service isolation passed" +
      (workerOnly ? "." : ", including public web routes and notices."),
  );
  check(
    appSql(
      "INSERT INTO domains(name) VALUES ('" + host + "') RETURNING name",
    ) === host,
    "Application data write failed",
  );
  const databaseId = inspect("database").Id;
  compose("restart", ...(workerOnly ? ["worker"] : ["web", "worker"]));
  await workerReady(2);
  if (!workerOnly) await verifyWeb();
  check(
    inspect("database").Id === databaseId &&
      appSql("SELECT name FROM domains WHERE name='" + host + "'") === host,
    "Restart lost stored data",
  );
  check(
    appSql("SELECT count(*) FROM scan_jobs") === "0",
    "Smoke test enqueued a scan",
  );
  console.log(
    "Stored domain survived restart and the scan queue stayed empty.",
  );
} finally {
  try {
    compose("down", "--volumes", "--remove-orphans", "--timeout", "10");
    const filter = "label=com.docker.compose.project=" + project;
    for (const args of [
      ["ps", "-aq"],
      ["network", "ls", "-q"],
      ["volume", "ls", "-q"],
    ])
      check(
        local(...args, "--filter", filter) === "",
        "Disposable Compose resources remain",
      );
    console.log(
      "Removed the smoke project's containers, networks and database volume.",
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
