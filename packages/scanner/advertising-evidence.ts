import { load } from "cheerio";
import { evidence as evidenceSchema, type Evidence } from "@datadeal/contracts";
import { extractPolicySections } from "./observations";
import { pageLanguage } from "./language";
import type { AdvertisingList, DirectoryLink } from "./advertising-referrals";
import type { ProviderPolicyReference } from "./provider-policy";

export type AdvertisingSection = {
  source: Evidence;
  lists: AdvertisingList[];
  directories: DirectoryLink[];
};

export async function advertisingEvidence(
  scanId: string,
  sections: AdvertisingSection[],
  fetchDocument: (
    url: URL,
    signal: AbortSignal,
  ) => Promise<{ url: URL; html: string }>,
  signal: AbortSignal,
) {
  const rows: Evidence[] = [];
  const providers: ProviderPolicyReference[] = [];
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(1800)]);
  let remaining = 24;
  function append(
    source: Evidence,
    lists: AdvertisingList[],
    referral?: string,
  ) {
    const heading =
      source.observation?.type === "policy_section"
        ? source.observation.heading
        : "";
    for (const [n, list] of lists.entries()) {
      if (!remaining) return;
      const id = source.id + "-list-" + (n + 1);
      const contextId = id + "-context";
      rows.push({
        ...source,
        id: contextId,
        excerpt: list.context,
        observation: {
          type: "policy_section",
          topic: "sharing",
          heading,
          ...(referral && { directoryReferralId: referral }),
        },
      });
      for (const [i, entry] of list.entries.entries()) {
        if (!remaining) return;
        const entryId = id + "-vendor-" + (i + 1);
        rows.push({
          ...source,
          id: entryId,
          excerpt: entry.excerpt,
          observation: {
            type: "policy_section",
            topic: "sharing",
            heading,
            vendorListing: {
              contextEvidenceId: contextId,
              policyUrl: entry.url,
            },
          },
        });
        providers.push({
          evidenceId: entryId,
          url: entry.url,
          context: list.context,
          advertisingList: true,
        });
        remaining--;
      }
    }
  }
  for (const section of sections) append(section.source, section.lists);
  // A single static, explicitly offered publisher directory may add substantive
  // listings. Never open a consent dialog, execute scripts or crawl its links.
  for (const { source, directories } of sections) {
    const link = directories[0];
    if (!link || !remaining || deadline.aborted) continue;
    const url = new URL(link.url);
    if (!source.url || url.origin !== new URL(source.url).origin) continue;
    const result = await fetchDocument(url, deadline).catch(() => undefined);
    if (!result || result.url.origin !== url.origin) break;
    const page = load(result.html);
    page("script,style,nav,footer,header nav").remove();
    const sections = extractPolicySections(page, result.url).filter(
      (section) => section.advertisingLists?.length,
    );
    if (!sections.length) break;
    const referralId = source.id + "-directory-referral";
    rows.push({ ...source, id: referralId, excerpt: link.excerpt });
    const language = evidenceSchema.shape.language.safeParse(
      pageLanguage(page),
    ).data;
    for (const [i, section] of sections.entries()) {
      append(
        {
          ...source,
          id: source.id + "-directory-" + (i + 1),
          url: result.url.href,
          language,
          retrievedAt: new Date().toISOString(),
          observation: {
            type: "policy_section",
            topic: "sharing",
            heading: section.title,
          },
        },
        section.advertisingLists!,
        referralId,
      );
    }
    break;
  }
  return { rows, providers };
}
