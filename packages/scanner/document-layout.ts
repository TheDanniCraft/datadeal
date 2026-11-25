import { createHash } from "node:crypto";
import type { CheerioAPI } from "cheerio";
import type { Evidence } from "@datadeal/contracts";

type Element = ReturnType<ReturnType<CheerioAPI["root"]>["find"]>[number];
type Layout = NonNullable<Evidence["documentLayout"]>;
type Kind = Layout[number]["kind"];

const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
const containers =
  /^(?:article|section|main|header|body|div|ul|ol|dl|table|thead|tbody|tr|td|th|blockquote|p|li|dt|dd|time|h[1-6])$/u;
const excluded =
  "script,style,noscript,template,nav,footer,aside,button,form,select,iframe,video,audio,[role=navigation],[role=banner],[role=contentinfo],[role=toolbar],[role=menu],[aria-hidden=true],[hidden]";

function role(tag: string): Kind {
  if (tag === "h1") return "title";
  if (/^h[2-6]$|^dt$/u.test(tag)) return "heading";
  if (tag === "li") return "item";
  if (tag === "time") return "metadata";
  return "paragraph";
}

export function captureDocument(page: CheerioAPI) {
  // Hash the same normalized full text used by historical report comparisons.
  // Reader filtering and snippet limits must never affect these bytes.
  page("script,style,nav,footer").remove();
  const fullText = normalize(page("main").text() || page("body").text());
  if (!fullText) return;
  const hash = createHash("sha256").update(fullText).digest("hex");
  const main = page("main,[role=main]").first();
  const root = (
    main.length
      ? main
      : page("article").length === 1
        ? page("article")
        : page("body")
  ).clone();
  root.find(excluded).remove();
  const layout: Layout = [];
  let excerpt = "";
  let full = false;
  function add(kind: Kind, text: string) {
    text = normalize(text);
    if (!text || text.length > 4000) return;
    const start = excerpt.length + (excerpt ? 2 : 0);
    if (start + text.length > 4000 || layout.length >= 100) {
      full = true;
      return;
    }
    excerpt += (excerpt ? "\n\n" : "") + text;
    layout.push({ kind, start, end: excerpt.length });
  }
  function read(element: Element, depth: number) {
    if (full || depth > 80) return;
    const kind = role(element.name);
    let text = "";
    let hasProse = false;
    function flush() {
      if (hasProse) {
        const clean = normalize(text);
        const emphasized =
          kind === "paragraph" &&
          clean.length <= 130 &&
          /^(?:[IVX]+|\d+(?:\.\d+)*)[.)]\s/u.test(clean) &&
          page(element)
            .children("b,strong")
            .toArray()
            .some((b) => normalize(page(b).text()) === clean);
        add(emphasized ? "heading" : kind, clean);
      }
      text = "";
      hasProse = false;
    }
    for (const child of page(element).contents().toArray()) {
      if (full) break;
      if (child.type === "text") {
        text += child.data;
        hasProse ||= Boolean(child.data.trim());
        continue;
      }
      if (child.type !== "tag") continue;
      if (containers.test(child.name)) {
        flush();
        read(child, depth + 1);
        continue;
      }
      if (child.name === "br") {
        text += " ";
        continue;
      }
      const inline = page(child).text();
      text += inline;
      // Standalone links outside a semantic passage are usually skip links or navigation.
      // An inline link in a sentence is kept with the original wording.
      if (
        child.name !== "a" ||
        (/^(?:h[1-6]|p|li|dt|dd)$/u.test(element.name) &&
          !page(child).attr("href")?.startsWith("#"))
      )
        hasProse ||= Boolean(inline.trim());
    }
    if (!full) flush();
  }
  const element = root.get(0);
  if (element) read(element, 0);
  if (!layout.length) add("title", page("head title").first().text());
  return excerpt ? { hash, excerpt, documentLayout: layout } : undefined;
}
