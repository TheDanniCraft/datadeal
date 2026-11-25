import type { CheerioAPI } from "cheerio";

const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();

/** A named cookie and a purpose in the same published table row are a disclosure. */
export function cookieTableSections($: CheerioAPI, cookieDocument: boolean) {
  const sections: { title: string; excerpt: string; topic: "purpose" }[] = [];
  const main = $("main,[role=main]").first();
  for (const element of (main.length ? main : $("body"))
    .find("table")
    .toArray()) {
    const table = $(element);
    if (
      table.closest("nav,header,footer,form,[hidden],[aria-hidden=true]").length
    )
      continue;
    const rows = table
      .find("tr")
      .filter(
        (_, r) =>
          $(r).closest("table")[0] === element &&
          !$(r).closest("[hidden],[aria-hidden=true]").length,
      );
    const header = rows.first().children("th,td");
    if (header.is("[colspan],[rowspan]")) continue;
    const labels = header
      .map((_, cell) => normalize($(cell).text()).toLowerCase())
      .get();
    const name = labels.findIndex(
      (label) =>
        /^(?:cookie(?: name)?|name (?:of (?:the )?cookie|des cookies)|cookie[- ]?name)$/.test(
          label,
        ) ||
        (cookieDocument && label === "name"),
    );
    const purpose = labels.findIndex((label) =>
      /^(?:purpose|description|function|zweck|verwendungszweck|beschreibung|funktion)$/.test(
        label,
      ),
    );
    if (name === -1 || purpose === -1) continue;
    for (const row of rows.slice(1).toArray()) {
      const cells = $(row).children("td,th");
      if (
        cells.length !== labels.length ||
        cells.is("[rowspan],[colspan],[hidden],[aria-hidden=true]") ||
        cells.find("table,form,input,[hidden],[aria-hidden=true]").length
      )
        continue;
      const cookie = normalize(cells.eq(name).text());
      const description = normalize(cells.eq(purpose).text());
      if (!/^[\w.*-]{1,80}$/.test(cookie) || description.length < 12) continue;
      const excerpt = cells
        .map((_, cell) => normalize($(cell).text()))
        .get()
        .join(" ");
      if (excerpt.length > 1600) continue;
      sections.push({ title: cookie, excerpt, topic: "purpose" });
      if (sections.length === 12) return sections;
    }
  }
  return sections;
}
