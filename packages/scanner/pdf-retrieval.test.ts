import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { load } from "cheerio";
import { beforeEach, expect, it, vi } from "vitest";
import { readPublicPolicyDocument } from "./index";
import { extractPdfText, maxPdfBytes } from "./pdf-document";

vi.mock("node:dns/promises", async (original) => ({
  ...(await original<typeof import("node:dns/promises")>()),
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request }));
vi.mock("./pdf-document", async (original) => ({
  ...(await original<typeof import("./pdf-document")>()),
  extractPdfText: vi.fn(),
}));
const signal = new AbortController().signal;
function respond(headers: Record<string, string>, body: Buffer, status = 200) {
  request.mockImplementationOnce((_url, _options, callback) => {
    const response = Object.assign(Readable.from([body]), {
      headers,
      statusCode: status,
    });
    return Object.assign(new EventEmitter(), { end: () => callback(response) });
  });
}
beforeEach(() => {
  request.mockReset();
  vi.mocked(extractPdfText).mockReset();
});

it.each([
  ["https://legal.example.org/privacy", "application/pdf; charset=binary"],
  ["https://legal.example.org/privacy.PDF", "application/octet-stream"],
])(
  "reads the approved PDF response at %s and retains its source URL",
  async (address, mime) => {
    const bytes = Buffer.from("%PDF-1.4");
    respond({ "content-type": mime }, bytes);
    vi.mocked(extractPdfText).mockResolvedValue(
      "Privacy policy\n\nWe store account details.",
    );
    const doc = await readPublicPolicyDocument(new URL(address), signal);
    expect(doc.url.href).toBe(address);
    expect(load(doc.html)("main p").text()).toBe("We store account details.");
    expect(extractPdfText).toHaveBeenCalledWith(bytes, signal);
  },
);

it("applies the byte cap before conversion and rejects an arbitrary binary download", async () => {
  respond({ "content-type": "application/pdf" }, Buffer.alloc(maxPdfBytes + 1));
  const url = new URL("https://legal.example.org/privacy");
  await expect(readPublicPolicyDocument(url, signal)).rejects.toThrow(
    "scan limit",
  );
  respond({ "content-type": "application/octet-stream" }, Buffer.from("data"));
  await expect(readPublicPolicyDocument(url, signal)).rejects.toThrow(
    "response type",
  );
  expect(extractPdfText).not.toHaveBeenCalled();
});

it("blocks a redirect outside the linked origin and treats unreadable PDFs as unavailable", async () => {
  const url = new URL("https://legal.example.org/policy.pdf");
  respond(
    { location: "https://elsewhere.example/policy.pdf" },
    Buffer.alloc(0),
    302,
  );
  await expect(readPublicPolicyDocument(url, signal)).rejects.toThrow("scope");
  expect(request).toHaveBeenCalledTimes(1);
  respond({ "content-type": "application/pdf" }, Buffer.from("broken"));
  vi.mocked(extractPdfText).mockResolvedValue(null);
  await expect(readPublicPolicyDocument(url, signal)).rejects.toThrow(
    "PDF policy text unavailable",
  );
});
