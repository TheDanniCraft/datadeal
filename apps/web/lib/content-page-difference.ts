import type { PublicContentPageSample } from "./content-pages";

export function biggestContentPageDifference(
  sample: PublicContentPageSample | undefined,
  homepage?: { id: string; outside: number },
) {
  if (!sample || !homepage || homepage.outside >= 20) return;
  const visits = sample.pages
    .flatMap((page) => page.visits)
    .filter((visit) => visit.scenario === "default" && visit.measurement)
    .map((visit) => visit.measurement!);
  return visits
    .filter((visit) => visit.outside > homepage.outside)
    .sort((a, b) => b.outside - a.outside)[0];
}

export function publicContentPageDifference(
  sample: PublicContentPageSample | undefined,
  homepage?: { id: string; outside: number },
) {
  const page = biggestContentPageDifference(sample, homepage);
  if (!page || !homepage) return;
  const location =
    page.finalPath.length <= 55 ? page.finalPath : "a sampled page";
  const outside = page.outside === 20 ? "at least 20" : page.outside;
  const unit = page.outside === 1 ? "domain" : "domains";
  return {
    text: `Before a consent choice, the browser tried to reach ${outside} outside ${unit} on ${location}, compared with ${homepage.outside} on the homepage.`,
    evidenceId: page.id,
  };
}
