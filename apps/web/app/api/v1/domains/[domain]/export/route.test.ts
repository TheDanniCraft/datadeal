import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getSession, hasPro, archivedReports, getScanArtifact } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    getScanArtifact: vi.fn(),
    hasPro: vi.fn(),
    archivedReports: vi.fn(),
  }),
);

vi.mock("../../../../../../lib/auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("../../../../../../lib/reports", () => ({
  database: { hasPro, archivedReports, getScanArtifact },
}));

const id = "d020d733-d6c8-40c5-a805-963e04e65432";
const domain = "example.com";
const download = (scan = id) =>
  GET(
    new Request(
      `https://datadeal.example/api/v1/domains/${domain}/export?scan=${scan}`,
    ),
    {
      params: Promise.resolve({ domain }),
    },
  );

beforeEach(() => {
  vi.resetAllMocks();
});

it("rejects guests and free accounts without reading the snapshot", async () => {
  getSession
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ user: { id: "free" } });
  hasPro.mockResolvedValue(false);
  expect((await download()).status).toBe(401);
  const denied = await download();
  expect(denied.status).toBe(403);
  expect(denied.headers.get("Cache-Control")).toBe("private, no-store");
  expect(archivedReports).not.toHaveBeenCalled();
  expect(getScanArtifact).not.toHaveBeenCalled();
});

it("exports the requested published snapshot and its computed score", async () => {
  getSession.mockResolvedValue({ user: { id: "pro" } });
  hasPro.mockResolvedValue(true);
  const report = {
    id,
    domain,
    completedAt: "2026-01-01T00:00:00Z",
    demo: false,
    partial: true,
    findings: [],
    evidence: [],
  };
  archivedReports.mockResolvedValue([{ report }]);
  const response = await download();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toBe(
    `attachment; filename="datadeal-${domain}-${id}.json"`,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const exported = await response.json();
  expect(exported).not.toHaveProperty("captureArtifact");
  expect(exported).toMatchObject({
    report,
    score: { grade: "Unrated", score: null },
  });
  expect(archivedReports).toHaveBeenCalledWith(domain, id, false);
  const artifact = {
    key: "scans/" + id + "/capture-v1.json",
    sha256: "a".repeat(64),
  };
  getScanArtifact.mockResolvedValue(artifact);
  expect((await (await download()).json()).captureArtifact).toEqual(artifact);
  expect(getScanArtifact).toHaveBeenCalledWith(domain, id);
});

it("rejects malformed references and returns 404 for missing reports", async () => {
  getSession.mockResolvedValue({ user: { id: "pro" } });
  hasPro.mockResolvedValue(true);
  archivedReports.mockResolvedValue([]);
  expect((await download("invalid")).status).toBe(400);
  expect(archivedReports).not.toHaveBeenCalled();
  expect((await download()).status).toBe(404);
});
