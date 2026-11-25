import { isPrivacyLinkLabel, processingDocumentKind } from "./sitemap";

// pdftotext supplies reading order, physical line breaks and page breaks, but
// no trustworthy DOM, link targets or heading levels.
const headingShape = (line: string) =>
  line.length <= 140 &&
  /^[\p{Lu}\p{Lt}\d]/u.test(line) &&
  !/[.!;,]$|[<>]/u.test(line) &&
  !/^(?:we|you|they|wir|sie)\s/iu.test(line);
const numberedHeading = /^(?:\d+(?:\.\d+)*[.)]?|[IVX]+\.)\s+\p{Lu}/u;
const questionHeading =
  /^(?:(?:\d+[.)]?|[IVX]+\.)\s+)?(?:who|what|where|when|why|how|which|do|does|can|is|are|was|wer|wie|wo|welche|warum|wann)\b/iu;
const sentenceEnd = /[.!?][”’"')]*$/u;
const startsSentence = /^[“„‘"'(]*[\p{Lu}\p{Lt}\d]/u;
const contentsTitle = /^(?:(?:table of )?contents|inhaltsverzeichnis)[:.]?$/iu;

function documentTitle(text: string) {
  return isPrivacyLinkLabel(text) || Boolean(processingDocumentKind(text));
}

function escaped(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Index entries refer to a later page; they do not disclose a practice.
function endOfContents(lines: string[], start: number) {
  const entries = new Set<string>();
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const label = line.replace(/\s*(?:[.·…]{2,}|\s)\s*\d+$/u, "").trim();
    if (entries.has(label)) break;
    if (!headingShape(label) && !/^\d+$/u.test(line)) break;
    entries.add(label);
  }
  return i;
}

export function pdfDocumentHtml(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replaceAll("\f", "\n\n")
    .trim()
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim());
  let titleAt = -1;
  let titleLines = 1;
  // A publisher logo or name sometimes precedes the actual document title.
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    if (!lines[i]) continue;
    if (contentsTitle.test(lines[i])) break;
    if (lines[i + 1] && documentTitle(lines[i] + " " + lines[i + 1])) {
      titleAt = i;
      titleLines = 2;
      break;
    }
    if (documentTitle(lines[i])) {
      titleAt = i;
      break;
    }
    if (!headingShape(lines[i])) break;
  }
  if (titleAt < 0 && !contentsTitle.test(lines[0]) && headingShape(lines[0]))
    titleAt = 0;
  const title = lines.slice(titleAt, titleAt + titleLines).join(" ");
  // In a numbered policy, short isolated strings are often table cells,
  // footers or contact details. The publisher already supplied an outline.
  const hasNumberedOutline =
    lines.some((line) => /^1[.)]\s+\p{Lu}/u.test(line)) &&
    lines.some((line) => /^2[.)]\s+\p{Lu}/u.test(line));
  const blocks: string[] = [];
  let paragraph: string[] = [];
  function flush() {
    if (paragraph.length)
      blocks.push("<p>" + escaped(paragraph.join(" ")) + "</p>");
    paragraph = [];
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || "";
    const priorLine = paragraph.at(-1);
    const boundary = !priorLine || sentenceEnd.test(priorLine);
    const wrappedQuestion =
      questionHeading.test(line) &&
      !line.endsWith("?") &&
      /^\p{Ll}/u.test(next) &&
      next.endsWith("?") &&
      headingShape(line + " " + next);
    const numbered = numberedHeading.test(line);
    const clearSection =
      numbered && (wrappedQuestion || !next || startsSentence.test(next));
    const inferredHeading =
      !hasNumberedOutline &&
      boundary &&
      (wrappedQuestion ||
        line.endsWith("?") ||
        (!lines[i - 1] && !next && line.length <= 80) ||
        (line.length <= 60 &&
          /^(?:We|You|Our|The|Wir|Sie|Die|Der|Das)\s/u.test(next)));
    if (i === titleAt) {
      flush();
      blocks.push("<h1>" + escaped(title) + "</h1>");
      i += titleLines - 1;
    } else if (!line) {
      flush();
    } else if (contentsTitle.test(line)) {
      flush();
      const end = endOfContents(lines, i);
      blocks.push("<nav>" + escaped(lines.slice(i, end).join("\n")) + "</nav>");
      i = end - 1;
    } else if (
      i >= titleAt + titleLines &&
      headingShape(line) &&
      (clearSection || inferredHeading)
    ) {
      flush();
      blocks.push(
        "<h2>" + escaped(wrappedQuestion ? line + " " + next : line) + "</h2>",
      );
      if (wrappedQuestion) i++;
    } else {
      if (priorLine && boundary && startsSentence.test(line)) flush();
      paragraph.push(line);
    }
  }
  flush();
  const head = titleAt >= 0 ? "<title>" + escaped(title) + "</title>" : "";
  return (
    "<html><head>" +
    head +
    "</head><body><main>\n" +
    blocks.join("\n") +
    "\n</main></body></html>"
  );
}
