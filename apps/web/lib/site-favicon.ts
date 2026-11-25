const bundled = new Map([
  ["bild.de", "/favicons/bild.png"],
  ["facebook.com", "/favicons/facebook.ico"],
  ["google.com", "/favicons/google.ico"],
  ["morgen.so", "/favicons/morgen.png"],
  ["thedannicraft.de", "/favicons/thedannicraft.png"],
]);

export function bundledSiteFavicon(host: string) {
  return bundled.get(host.replace(/^www\./, ""));
}
