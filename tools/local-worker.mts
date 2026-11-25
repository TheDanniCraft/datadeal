import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
  type JsonWebKey,
} from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createLockServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  analysisInput,
  practiceAnalysisInput,
  completeAnalysisReview,
  completePolicyReview,
  publishPolicyClaims,
  promptVersion,
  validateCandidates,
  publishDataPractices,
  analysisInstructions,
  AnalysisProviderError,
  privacyDocumentSelector,
  selectAnalysisEvidence,
  selectPolicyEvidence,
} from "../packages/ai/index";
import { scan } from "../packages/scanner/index";
import { runWorker } from "../apps/worker/run";
import { connect } from "../packages/database/index";
import { scanReport, type ScanReport } from "../packages/contracts/index";
import {
  calculateScore,
  calculateAcceptAllScore,
  calculateRejectScore,
  evaluateHeadline,
} from "../packages/scoring/index";
import { readAnalysisStream } from "./local-analysis-stream";
import { startLocalBrowserProxy } from "./local-browser-proxy";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const planScope = "chatgpt.tokens.use.direct";
const legacyRegistrationFile = join(
  homedir(),
  ".datadeal-local",
  "registration.json",
);
const stateFile = fileURLToPath(
  new URL("../.env.development.oauth", import.meta.url),
);
const model = "gpt-6.1-sol";
type LocalState = {
  host: string;
  clientId?: string;
  subject?: string;
  session?: { token: string; expiresAt: number; refreshToken?: string };
};

function protectState(operation: "Protect" | "Unprotect", input: string) {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$output = [Security.Cryptography.ProtectedData]::${operation}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Write([Convert]::ToBase64String($output))`,
    ],
    {
      input,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    },
  ).trim();
}

async function saveState(state: LocalState) {
  const sealed = protectState(
    "Protect",
    Buffer.from(JSON.stringify(state)).toString("base64"),
  );
  const temporary = stateFile + "." + randomUUID();
  try {
    await writeFile(
      temporary,
      "DATADEAL_CHATGPT_OAUTH_DPAPI=" + sealed + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await rename(temporary, stateFile);
  } finally {
    await rm(temporary, { force: true });
  }
}

function openBrowser(url: URL) {
  // Pass the URL through stdin so it never enters shell source or process arguments.
  if (process.platform !== "win32")
    throw new Error("This development launcher currently supports Windows.");
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Start-Process -FilePath ([Console]::In.ReadToEnd())",
    ],
    { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
  );
  child.stdin.end(url.href);
  return once(child, "exit").then(([code]) => {
    if (code !== 0) throw new Error("Could not open the OpenAI sign-in page.");
  });
}

async function validatedSubject(jwt: string, clientId: string, nonce: string) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Invalid OpenAI identity token.");
  const [header, claims, signature] = parts;
  const { alg, kid } = JSON.parse(Buffer.from(header, "base64url").toString());
  if (alg !== "RS256" || typeof kid !== "string")
    throw new Error("Unexpected OpenAI identity token signature.");
  const response = await fetch(issuer + "/.well-known/jwks.json", {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Could not verify OpenAI identity.");
  const { keys }: { keys: (JsonWebKey & { kid?: string })[] } =
    await response.json();
  const key = keys.find((item) => item.kid === kid && item.kty === "RSA");
  if (
    !key ||
    !verify(
      "RSA-SHA256",
      Buffer.from(header + "." + claims),
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(signature, "base64url"),
    )
  )
    throw new Error("Could not verify OpenAI identity signature.");
  const {
    iss,
    aud,
    azp,
    exp,
    sub,
    nbf,
    nonce: returnedNonce,
  } = JSON.parse(Buffer.from(claims, "base64url").toString());
  const audiences = Array.isArray(aud) ? aud : [aud];
  const now = Date.now() / 1000;
  if (
    iss !== issuer ||
    !audiences.includes(clientId) ||
    ((audiences.length > 1 || azp !== undefined) && azp !== clientId) ||
    !Number.isFinite(exp) ||
    exp <= now ||
    (nbf !== undefined && (!Number.isFinite(nbf) || nbf > now)) ||
    returnedNonce !== nonce ||
    typeof sub !== "string" ||
    !sub
  )
    throw new Error("OpenAI identity token did not match this sign-in.");
  return sub as string;
}

async function registration(): Promise<LocalState> {
  try {
    const sealed = /^DATADEAL_CHATGPT_OAUTH_DPAPI=([A-Za-z0-9+/=]+)\s*$/.exec(
      await readFile(stateFile, "utf8"),
    )?.[1];
    if (!sealed) throw new Error("Invalid local OAuth environment file.");
    return JSON.parse(
      Buffer.from(protectState("Unprotect", sealed), "base64").toString("utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let saved: LocalState;
  let migrate = false;
  try {
    saved = JSON.parse(await readFile(legacyRegistrationFile, "utf8"));
    migrate = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    saved = { host: "urn:uuid:" + randomUUID() };
  }
  await saveState(saved);
  if (migrate) await rm(legacyRegistrationFile);
  return saved;
}

async function authorize(saved: LocalState) {
  const [state, nonce, verifier] = Array.from({ length: 3 }, () =>
    randomBytes(32).toString("base64url"),
  );
  const server = createServer();
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No loopback listener.");
    const callback = new URL(`http://127.0.0.1:${address.port}/auth/callback`);
    const codePromise = new Promise<{ code: string; clientId: string }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("OpenAI sign-in timed out.")),
          180000,
        );
        server.on("request", (request, response) => {
          if (
            request.method !== "GET" ||
            request.headers.host !== callback.host
          ) {
            response.writeHead(404).end();
            return;
          }
          const url = new URL(request.url ?? "/", callback);
          if (
            url.origin !== callback.origin ||
            url.pathname !== callback.pathname ||
            url.searchParams.get("state") !== state
          ) {
            response.writeHead(404).end();
            return;
          }
          clearTimeout(timer);
          const code = url.searchParams.get("code");
          const returnedClient = url.searchParams.get("client_id");
          const clientId = returnedClient ?? saved.clientId;
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Referrer-Policy", "no-referrer");
          if (
            !code ||
            !clientId ||
            clientId === "dynamic_agent_client" ||
            url.searchParams.has("error") ||
            (saved.clientId && clientId !== saved.clientId)
          ) {
            response
              .writeHead(400)
              .end("Sign-in did not complete. Return to DataDeal.");
            reject(new Error("OpenAI did not authorize this local client."));
            return;
          }
          response.end(
            "DataDeal received the sign-in callback. Return to your terminal.",
          );
          resolve({ code, clientId });
        });
        server.once("close", () => clearTimeout(timer));
      },
    );
    const url = new URL(issuer + "/api/accounts/authorize");
    url.search = new URLSearchParams({
      client_id: saved.clientId ?? "dynamic_agent_client",
      ...(!saved.clientId && { agent_name_hint: "DataDeal" }),
      ext_agent_host_id: saved.host,
      response_type: "code",
      redirect_uri: callback.href,
      scope: "openid profile email offline_access resource.invoke " + planScope,
      resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).toString();
    console.info(
      "Continue with ChatGPT in your browser. Eligible requests use your ChatGPT plan.",
    );
    const [{ code, clientId }] = await Promise.all([
      codePromise,
      openBrowser(url),
    ]);
    const response = await fetch(issuer + "/api/accounts/oauth/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: callback.href,
        resource,
      }),
    });
    if (!response.ok)
      throw new Error(`OAuth token exchange failed (HTTP ${response.status}).`);
    const {
      access_token,
      refresh_token,
      id_token,
      scope,
      expires_in,
    }: {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      scope?: string;
      expires_in?: number;
    } = await response.json();
    if (
      !access_token ||
      !id_token ||
      !scope?.split(/\s+/).includes(planScope) ||
      typeof expires_in !== "number" ||
      !Number.isFinite(expires_in) ||
      expires_in <= 0
    )
      throw new Error("OpenAI did not grant ChatGPT plan usage.");
    const subject = await validatedSubject(id_token, clientId, nonce);
    if (saved.subject && saved.subject !== subject)
      throw new Error(
        "The authorized account does not match the local registration.",
      );
    await saveState({
      host: saved.host,
      clientId,
      subject,
      session: {
        token: access_token,
        refreshToken:
          typeof refresh_token === "string" ? refresh_token : undefined,
        expiresAt: Date.now() + expires_in * 1000,
      },
    });
    return access_token;
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

async function refreshLocalSession(previous: LocalState, signal: AbortSignal) {
  if (!previous.session?.refreshToken || !previous.clientId) return undefined;
  // A loopback listener serializes rotating credentials across local processes.
  const port =
    49152 +
    (createHash("sha256")
      .update(stateFile.toLowerCase())
      .digest()
      .readUInt16BE() %
      16384);
  const lock = createLockServer((socket) => socket.destroy());
  for (;;) {
    signal.throwIfAborted();
    try {
      lock.listen({ host: "127.0.0.1", port, exclusive: true });
      await once(lock, "listening");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      await delay(150, undefined, { signal });
    }
  }
  try {
    const saved = await registration();
    if (
      saved.session?.token !== previous.session.token &&
      saved.session &&
      saved.session.expiresAt > Date.now() + 60000
    )
      return saved.session.token;
    if (!saved.session?.refreshToken || !saved.clientId) return undefined;
    const response = await fetch(issuer + "/api/accounts/oauth/token", {
      method: "POST",
      redirect: "error",
      signal,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: saved.clientId,
        refresh_token: saved.session.refreshToken,
        resource,
      }),
    });
    const grant = await response.json().catch(() => null);
    if (!response.ok) {
      if (grant?.error === "invalid_grant") return undefined;
      throw new AnalysisProviderError(response.status);
    }
    if (
      typeof grant?.access_token !== "string" ||
      !grant.access_token ||
      typeof grant.expires_in !== "number" ||
      !Number.isFinite(grant.expires_in) ||
      grant.expires_in <= 0 ||
      (grant.scope !== undefined &&
        (typeof grant.scope !== "string" ||
          !grant.scope.split(/\s+/).includes(planScope)))
    )
      throw new Error(
        "ChatGPT session refresh did not return valid credentials.",
      );
    await saveState({
      ...saved,
      session: {
        token: grant.access_token,
        refreshToken:
          typeof grant.refresh_token === "string" && grant.refresh_token
            ? grant.refresh_token
            : saved.session.refreshToken,
        expiresAt: Date.now() + grant.expires_in * 1000,
      },
    });
    console.info("Refreshed the saved local ChatGPT session.");
    return grant.access_token as string;
  } finally {
    lock.close();
  }
}

async function localToken(
  allowSignIn = true,
  signal = AbortSignal.timeout(10000),
) {
  signal.throwIfAborted();
  const saved = await registration();
  if (saved.session && saved.session.expiresAt > Date.now() + 60000) {
    const response = await fetch(resource + "/models", {
      headers: { Authorization: "Bearer " + saved.session.token },
      redirect: "error",
      signal,
    });
    await response.body?.cancel();
    if (response.ok) {
      console.info("Using the saved local ChatGPT session.");
      return saved.session.token;
    }
    if (response.status !== 401)
      throw new AnalysisProviderError(response.status);
  }
  const refreshed = await refreshLocalSession(saved, signal);
  if (refreshed) return refreshed;
  if (!allowSignIn) {
    console.warn(
      "Local ChatGPT session expired. Run the smoke check or restart the worker to sign in again.",
    );
    throw new Error("Local ChatGPT sign-in required.");
  }
  return authorize(saved);
}

async function infer(
  token: string,
  instructions: string,
  input: string,
  signal = AbortSignal.timeout(95000),
) {
  const response = await fetch(resource + "/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    redirect: "error",
    signal,
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      instructions,
      input: [{ role: "user", content: input }],
      store: false,
      stream: true,
    }),
  });
  return readAnalysisStream(response);
}

const args = process.argv.slice(2);
const smoke = args[0] === "--smoke";
const scanDomain = args[0] === "--scan" ? args[1] : undefined;
const replayDomain =
  args[0] === "--replay" && args.length === 3 ? args[1] : undefined;
const recoverDomain =
  args[0] === "--recover-summary" &&
  (args.length === 3 || (args.length === 4 && args[3] === "--apply"))
    ? args[1]
    : undefined;
if (process.env.NODE_ENV === "production")
  throw new Error("ChatGPT OAuth is only available for local development.");
if (process.platform !== "win32")
  throw new Error(
    "The local OAuth worker requires Windows credential encryption.",
  );
if (args.length && !smoke && !scanDomain && !replayDomain && !recoverDomain)
  throw new Error(
    "Use --smoke, --scan DOMAIN, --replay DOMAIN SCAN_ID, or --recover-summary DOMAIN SCAN_ID [--apply].",
  );
if (!smoke && !scanDomain) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for the local worker.");
  const db = new URL(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname))
    throw new Error(
      "The OAuth development worker requires a loopback database.",
    );
}
try {
  if (smoke) {
    let verificationToken = await localToken();
    if (args.includes("--refresh")) {
      const saved = await registration();
      if (!saved.session?.refreshToken) await authorize(saved);
      verificationToken =
        (await refreshLocalSession(
          await registration(),
          AbortSignal.timeout(10000),
        )) ?? "";
    }
    if (!verificationToken)
      throw new Error("No renewable ChatGPT session was returned.");
    const reply = await infer(
      verificationToken,
      "Reply with exactly OK.",
      "Connection test.",
    );
    if (reply.trim() !== "OK")
      throw new Error("Unexpected smoke-test response.");
    console.info("ChatGPT plan inference verified.");
  } else {
    const analyzer = {
      model: model + " (ChatGPT plan)",
      selectPrivacyDocuments: privacyDocumentSelector(
        async (instructions, input, signal) =>
          infer(await localToken(false, signal), instructions, input, signal),
      ),
      async analyze(evidence: Parameters<typeof analysisInput>[0]) {
        const input = JSON.stringify(practiceAnalysisInput(evidence));
        const output = await infer(
          await localToken(Boolean(scanDomain)),
          analysisInstructions +
            " Return only JSON. Keep citations concise. Include up to eight material practice judgments across measured scenarios and up to five policy claims. Leave legacy findings empty.",
          input,
        );
        return completeAnalysisReview(
          JSON.parse(output),
          evidence,
          async (instructions, input, signal) =>
            infer(await localToken(false, signal), instructions, input, signal),
        );
      },
    };
    if (recoverDomain) {
      const db = connect(process.env.DATABASE_URL!);
      try {
        const { report, output } = await db.policyReviewSource(
          args[2],
          recoverDomain,
        );
        if (
          report.policySummaryAddendum ||
          report.policyBrief?.length ||
          report.policyClaims?.length
        ) {
          console.info("This scan already has published policy analysis.");
        } else {
          const sources = selectAnalysisEvidence(report.evidence);
          const prior = validateCandidates(output, sources);
          const recovered = await completePolicyReview(
            prior,
            sources,
            async (instructions, input) => {
              const signal = AbortSignal.timeout(35_000);
              return infer(
                await localToken(false, signal),
                instructions,
                input,
                signal,
              );
            },
          );
          const items = (recovered.brief ?? []).flatMap((item) =>
            item.quote ? [{ ...item, quote: item.quote }] : [],
          );
          const topics = {
            data_category: "collection",
            purpose: "purpose",
            recipient: "sharing",
            retention: "retention",
          } as const;
          const lines: NonNullable<
            ScanReport["policySummaryAddendum"]
          >["items"] = [...items];
          for (const claim of publishPolicyClaims(
            recovered,
            sources,
            report.id,
          )) {
            const topic = topics[claim.category];
            if (lines.length >= 3) break;
            if (
              claim.confidence === "low" ||
              claim.text.length > 230 ||
              claim.quote.length < 18 ||
              lines.some((item) => item.topic === topic) ||
              !sources.some(
                (source) =>
                  source.id === claim.source &&
                  source.observation?.type === "policy_section" &&
                  source.observation.topic === topic,
              )
            )
              continue;
            lines.push({
              topic,
              source: claim.source,
              text: claim.text,
              quote: claim.quote,
            });
          }
          if (!lines.length)
            throw new Error(
              "The saved evidence yielded no publishable policy summary.",
            );
          const addendum = {
            model: analyzer.model,
            promptVersion,
            reviewedAt: new Date().toISOString(),
            items: lines,
          };
          const status =
            args[3] === "--apply"
              ? await db.savePolicySummaryAddendum(
                  report.id,
                  report.domain,
                  addendum,
                )
              : "preview";
          console.info(
            JSON.stringify(
              { domain: report.domain, scanId: report.id, status, ...addendum },
              null,
              2,
            ),
          );
        }
      } finally {
        await db.close();
      }
    } else if (scanDomain || replayDomain) {
      const report = scanDomain
        ? await scan(randomUUID(), scanDomain, analyzer.selectPrivacyDocuments)
        : await (async () => {
            const db = connect(process.env.DATABASE_URL!);
            try {
              const [snapshot] = await db.archivedReports(
                replayDomain!,
                args[2],
                false,
              );
              const report = scanReport.parse(snapshot?.report);
              if (report.id !== args[2])
                throw new Error(
                  "Published scan ID differs from the requested scan.",
                );
              return report;
            } finally {
              await db.close();
            }
          })();
      const evidence = replayDomain
        ? selectAnalysisEvidence(report.evidence)
        : selectPolicyEvidence(report.evidence);
      if (!evidence.length)
        throw new Error("The scan did not retrieve policy evidence.");
      console.info(
        `Analyzing ${evidence.length} sources for ${report.domain} (scan ${report.id}).`,
      );
      const result = await analyzer.analyze(evidence);
      const replay = replayDomain && {
        ...report,
        ...publishDataPractices(report, result.practices),
      };
      console.info(
        JSON.stringify(
          {
            domain: report.domain,
            evidenceSources: evidence.length,
            claims: result.claims.length,
            ...(replay && {
              storedHeadline: evaluateHeadline(report).rating.score,
              reconsidered: {
                before: calculateScore(replay).score,
                afterReject: calculateRejectScore(replay)?.score,
                afterAccept: calculateAcceptAllScore(replay)?.score,
              },
              practiceCoverage: replay.practiceCoverage,
              reviewedPractices: replay.dataPractices
                .filter((p) => p.interpretation === "analyst_reviewed")
                .map(({ scenario, summary, role, purpose, evidence }) => ({
                  scenario,
                  summary,
                  role,
                  purpose,
                  evidence,
                })),
            }),
            retention: result.claims
              .filter(
                ({ category, supportingQuote }) =>
                  category === "retention" && supportingQuote,
              )
              .map(({ claim, supportingQuote }) => ({
                claim,
                source: supportingQuote?.evidenceId,
                quote: supportingQuote?.text,
              })),
            brief: result.brief?.map(({ topic, text, source }) => ({
              topic,
              text,
              source,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      await localToken();
      process.env.DATADEAL_CONSENT_DOMAINS ??= "*";
      const proxy =
        process.env.DATADEAL_CONSENT_DOMAINS?.trim() &&
        !process.env.DATADEAL_BROWSER_PROXY
          ? await startLocalBrowserProxy()
          : undefined;
      if (proxy) process.env.DATADEAL_BROWSER_PROXY = proxy.url;
      try {
        await runWorker(analyzer);
      } finally {
        proxy?.close();
      }
    }
  }
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? "Invalid JSON response."
      : error instanceof Error
        ? error.message
        : "Local worker failed.",
  );
  process.exitCode = 1;
}
