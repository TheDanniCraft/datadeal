import { realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig, type ConfigEnv } from "wxt";
import { createReviewerWorkspace, sourcePatterns } from "./reviewer-source";

// `wxt dev`, or a build with WXT_DATADEAL_LOCAL=true, talks to the local site.
const local = (command: ConfigEnv["command"]) =>
  command === "serve" || process.env.WXT_DATADEAL_LOCAL === "true";
const reportOrigin = (command: ConfigEnv["command"]) =>
  local(command) ? "http://localhost:3000" : "https://datadeal.app";

function packageManifest(name: string, from: string) {
  const path = findPackageJSON(name, from);
  if (!path) throw new Error(`Missing package for extension notices: ${name}`);
  return realpathSync(path);
}

let reviewerWorkspace:
  Awaited<ReturnType<typeof createReviewerWorkspace>> | undefined;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: ({ command }) => ({
    define: { DATADEAL_REPORT_ORIGIN: JSON.stringify(reportOrigin(command)) },
  }),
  hooks: {
    "vite:build:extendConfig": (entries, config) => {
      const group = entries
        .map((entry) => entry.name)
        .sort()
        .join("-");
      config.build ??= {};
      config.build.license = { fileName: `licenses/${group}.md` };
    },
    "zip:sources:start": async (wxt) => {
      reviewerWorkspace = await createReviewerWorkspace(
        resolve(wxt.config.root, "../.."),
      );
      wxt.config.zip.sourcesRoot = reviewerWorkspace.path;
    },
    "zip:done": async () => {
      await reviewerWorkspace?.remove();
      reviewerWorkspace = undefined;
    },
    "build:publicAssets": (wxt, files) => {
      files.push({
        absoluteSrc: resolve(wxt.config.root, "../web/app/fonts/Inter-OFL.txt"),
        relativeDest: "licenses/Inter-OFL.txt",
      });
      // CSS imports and Vite's virtual preload/interop modules are outside
      // its JavaScript package license inventory.
      const from = resolve(wxt.config.root, "wxt.config.ts");
      const styles = packageManifest("@heroui/styles", from);
      const vite = packageManifest("vite", packageManifest("wxt", from));
      const rolldown = packageManifest("rolldown", vite);
      for (const [manifest, file, dest] of [
        [packageManifest("tailwindcss", from), "LICENSE", "Tailwind-CSS.txt"],
        [
          packageManifest("tw-animate-css", styles),
          "LICENSE",
          "tw-animate-css.txt",
        ],
        [vite, "LICENSE.md", "Vite.md"],
        [rolldown, "LICENSE", "Rolldown.txt"],
        [rolldown, "THIRD-PARTY-LICENSE", "Rolldown-third-party.txt"],
      ] as const) {
        files.push({
          absoluteSrc: resolve(dirname(manifest), file),
          relativeDest: `licenses/${dest}`,
        });
      }
    },
  },
  zip: {
    sourcesRoot: "../..",
    includeSources: sourcePatterns,
  },
  manifest: ({ browser, command }) => ({
    name: "DataDeal",
    description: "Look up a privacy report for the active website.",
    permissions: ["activeTab", "scripting", "storage"],
    // Browser scans run in a private window, driven from the normal one.
    incognito: "spanning",
    ...(browser === "firefox"
      ? {
          optional_permissions: [
            "https://*/*",
            "http://*/*",
            "webRequest",
            "cookies",
          ],
          browser_specific_settings: {
            gecko: {
              id: "extension@datadeal.app",
              strict_min_version: "140.0",
              data_collection_permissions: { required: ["browsingActivity"] },
            },
          },
        }
      : {
          optional_permissions: ["webRequest", "cookies"],
          optional_host_permissions: ["https://*/*", "http://*/*"],
        }),
    host_permissions: [
      local(command) ? "http://localhost/*" : "https://datadeal.app/*",
      // Local builds grant the browser-scan permissions at install, so the
      // flow can be tested without the browser's permission prompt.
      ...(local(command) ? ["https://*/*", "http://*/*"] : []),
    ],
    ...(local(command) && {
      permissions: [
        "activeTab",
        "scripting",
        "storage",
        "webRequest",
        "cookies",
      ],
    }),
  }),
});
