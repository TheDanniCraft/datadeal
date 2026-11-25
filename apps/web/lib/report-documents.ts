import type { Evidence } from "@datadeal/contracts";

const documentName =
  /(?:privacy|datenschutz|confidentialit[eé]|cookies?|(?:^|[\/_ -])retention(?:$|[\/_. -])|terms[-_ ]of[-_ ](?:service|use)|(?:^|\/)terms(?:\/|[.-]|$)|nutzungsbedingungen|allgemeine geschäftsbedingungen|data[-_ ]processing[-_ ](?:agreement|addendum)|subprocessors?|sub-processors?)/iu;
const directory =
  /(?:^|[/?#_. -])(?:impressum|imprint|contact|kontakt|directory)(?:[/?#_. -]|$)/iu;

export function isPolicyDocument(row: Evidence) {
  if (
    row.observation?.type === "provider_policy" ||
    row.observation?.type === "processing_document"
  )
    return true;
  if (row.kind !== "declared_first_party" || !row.url) return false;
  if (row.documentKind)
    return ["privacy", "cookies", "terms", "retention"].includes(
      row.documentKind,
    );
  const url = new URL(row.url);
  const title = row.documentLayout?.find(
    (block) => block.kind === "title" || block.kind === "heading",
  );
  const name = title ? row.excerpt.slice(title.start, title.end) : "";
  if (
    directory.test(url.pathname) ||
    /^\s*(?:impressum|imprint|contact directory)\b/iu.test(name || row.excerpt)
  )
    return false;
  return (
    documentName.test(url.pathname) ||
    documentName.test(url.hostname.split(".")[0]) ||
    documentName.test(name) ||
    (!row.observation &&
      /^(?:[^.!?]{0,45}[:|–-]\s*)?(?:privacy (?:policy|notice)|datenschutzerklärung|cookie policy|terms of (?:use|service))\b/iu.test(
        row.excerpt,
      ))
  );
}

export function readingBlockKind(
  text: string,
  original: "title" | "heading" | "paragraph" | "item" | "metadata",
) {
  if (original !== "paragraph" || text.length > 130) return original;
  if (
    /^(?:[IVX]+|\d{1,2}(?:\.\d{1,2})*)[.)]\s+\p{Lu}[^.!?]{1,120}$/u.test(
      text.trim(),
    )
  )
    return "heading";
  return original;
}
