import { execFile } from "node:child_process";

export const maxPdfBytes = 4_000_000;
const maxTextBytes = 1_000_000;
const systemVariables = new Set([
  "path",
  "systemroot",
  "windir",
  "temp",
  "tmp",
  "tmpdir",
  "appdata",
  "localappdata",
  "programdata",
  "userprofile",
  "home",
]);

/** Extract embedded text offline. A failed or incomplete extraction supplies no evidence. */
export async function extractPdfText(
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<string | null> {
  if (
    signal?.aborted ||
    bytes.length > maxPdfBytes ||
    !bytes.subarray(0, 1024).includes("%PDF-")
  )
    return null;

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      systemVariables.has(key.toLowerCase()),
    ),
  );
  return new Promise((resolve) => {
    const reader = execFile(
      "pdftotext",
      ["-enc", "UTF-8", "-eol", "unix", "-", "-"],
      {
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 4_000,
        killSignal: "SIGKILL",
        maxBuffer: maxTextBytes,
        signal,
      },
      (error, text, diagnostics) => {
        // Poppler can return success with text from only the undamaged pages.
        const parseFailed =
          /^(?:Syntax Error|I\/O Error|Internal Error|Unimplemented Feature)\b/im.test(
            diagnostics,
          );
        resolve(error || parseFailed ? null : text.trim() || null);
      },
    );
    // A reader that exits early can close stdin while bytes are still queued.
    reader.stdin?.on("error", () => resolve(null));
    reader.stdin?.end(bytes);
  });
}
