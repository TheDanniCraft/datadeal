import { connect } from "../packages/database/index";

const [domain, id, ...options] = process.argv.slice(2);
if (
  !domain ||
  !id ||
  !/^[a-f0-9-]{36}$/i.test(id) ||
  options.some(
    (arg) => !["--apply", "--policy-coverage", "--unrated"].includes(arg),
  ) ||
  (options.includes("--unrated") && options.includes("--policy-coverage"))
) {
  throw new Error(
    "Usage: correct-quiet-visit.mts DOMAIN SCAN_ID [--policy-coverage | --unrated] [--apply]",
  );
}
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw new Error("Local development database required.");
const db = connect(url.href);
try {
  console.log(
    JSON.stringify({
      domain,
      id,
      ...(options.includes("--unrated")
        ? await db.reviewUnratedCapture(id, domain, options.includes("--apply"))
        : options.includes("--policy-coverage")
          ? await db.correctPolicyCoverage(
              id,
              domain,
              options.includes("--apply"),
            )
          : await db.correctQuietVisitRating(
              id,
              domain,
              options.includes("--apply"),
            )),
    }),
  );
} finally {
  await db.close();
}
