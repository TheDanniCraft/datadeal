import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { configuredContentPageLimit, contentPageSample } from "./content-pages";
import { discoverSitemap } from "./sitemap";

describe("public content page discovery", () => {
  const home = new URL("https://example.com/");
  it("respects the worker's validated limit while reporting the complete discovered count", () => {
    const links = Array.from(
      { length: 16 },
      (_, i) => new URL("/news/story-" + i, home).href,
    );
    expect(configuredContentPageLimit()).toBe(3);
    for (const invalid of [
      "0",
      "13",
      "-1",
      "4.5",
      "Infinity",
      "none",
      "",
      "0x5",
    ]) {
      expect(() => configuredContentPageLimit(invalid)).toThrow(
        "CONTENT_PAGE_LIMIT",
      );
    }
    const small = contentPageSample(
      home,
      load(""),
      links.slice(0, 5),
      false,
      configuredContentPageLimit("5"),
    );
    expect(small).toMatchObject({
      discovered: 5,
      discoveryLimited: false,
      limit: 5,
    });
    expect(small.pages.map((page) => page.url)).toEqual(links.slice(0, 5));
    const large = contentPageSample(
      home,
      load(""),
      links,
      true,
      configuredContentPageLimit("12"),
    );
    expect(large).toMatchObject({
      discovered: 16,
      discoveryLimited: true,
      limit: 12,
    });
    expect(large.pages).toHaveLength(12);
    expect(() => contentPageSample(home, load(""), links, false, 13)).toThrow();
  });
  it("includes all eligible pages on a small sitemap and drops cross-origin, private, action and parameterized URLs", async () => {
    const paths = [
      "/",
      "/projects",
      "/booking-details",
      "/legal/privacy",
      "/checkout",
      "/account",
      "/document?token=abc",
      "https://other.org/",
      "/assets/news.png",
    ];
    const discovery = await discoverSitemap(home, async (url) =>
      url.pathname === "/sitemap.xml"
        ? "<urlset>" +
          paths
            .map(
              (path) =>
                "<url><loc>" + new URL(path, home).href + "</loc></url>",
            )
            .join("") +
          "</urlset>"
        : "",
    );
    const result = contentPageSample(
      home,
      load('<a href="/projects#work">Work</a>'),
      discovery.contentUrls,
      discovery.discoveryLimited,
    );
    expect(result).toMatchObject({
      discovered: 2,
      discoveryLimited: false,
      limit: 3,
    });
    expect(result.pages.map((p) => p.url).sort()).toEqual([
      "https://example.com/booking-details",
      "https://example.com/projects",
    ]);
    expect(result.pages.every((p) => p.source === "sitemap")).toBe(true);
  });
  it("selects content from distinct sections with a bounded index fetch and reports skipped maps", async () => {
    const requests: string[] = [];
    const discovery = await discoverSitemap(home, async (url) => {
      requests.push(url.pathname);
      if (url.pathname === "/robots.txt") return "";
      if (url.pathname === "/sitemap.xml")
        return (
          "<sitemapindex>" +
          [0, 1, 2, 3, 4]
            .map(
              (i) =>
                `<sitemap><loc>https://example.com/map${i}.xml</loc></sitemap>`,
            )
            .join("") +
          "</sitemapindex>"
        );
      return (
        "<urlset>" +
        [1, 2, 3, 4, 5]
          .map(
            (i) =>
              `<url><loc>https://example.com/section/${url.pathname.slice(1, 5)}-news-of-the-day-${i}.html</loc></url>`,
          )
          .join("") +
        "</urlset>"
      );
    });
    const result = contentPageSample(
      home,
      load(
        '<article><a href="/tech/recent-story-new-release">Read</a></article><a href="/api/invite">Join</a><a href="/private" hidden>Private</a>',
      ),
      discovery.contentUrls,
      discovery.discoveryLimited,
    );
    expect(requests).toHaveLength(5);
    expect(result).toMatchObject({
      limit: 3,
      discovered: 16,
      discoveryLimited: true,
    });
    expect(result.pages).toHaveLength(3);
    expect(result.pages).toContainEqual(
      expect.objectContaining({
        url: home.origin + "/tech/recent-story-new-release",
        source: "homepage_link",
      }),
    );
    expect(result.pages[0].source).toBe("sitemap");
  });
});
