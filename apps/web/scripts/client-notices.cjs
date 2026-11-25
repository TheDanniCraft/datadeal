const {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
} = require("node:fs");
const { basename, dirname, join, resolve, sep } = require("node:path");
const { createRequire } = require("node:module");

// PostCSS inlines these imports from globals.css before webpack sees its modules.
const stylesheets = ["tailwindcss", "@heroui/styles", "@heroui-pro/react"];

module.exports = function clientNotices(compiler) {
  const name = "DataDealClientNotices";
  compiler.hooks.thisCompilation.tap(name, (compilation) => {
    compilation.hooks.processAssets.tap(
      { name, stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
      () => {
        const manifests = new Map();
        const directories = new Map();
        function owner(directory) {
          if (
            !directory.includes(sep + "node_modules" + sep) ||
            basename(directory) === "node_modules"
          )
            return null;
          if (directories.has(directory)) return directories.get(directory);
          const path = join(directory, "package.json");
          const manifest = existsSync(path)
            ? JSON.parse(readFileSync(path, "utf8"))
            : null;
          const found = manifest?.name ? directory : owner(dirname(directory));
          directories.set(directory, found);
          if (manifest?.name) manifests.set(directory, manifest);
          return found;
        }
        const visited = new Set();
        function include(module) {
          if (visited.has(module)) return;
          visited.add(module);
          if (module.resource) owner(dirname(module.resource.split("?")[0]));
          for (const nested of module.modules ?? []) include(nested);
        }
        for (const chunk of compilation.chunks) {
          for (const module of compilation.chunkGraph.getChunkModulesIterable(
            chunk,
          ))
            include(module);
        }
        for (const pkg of stylesheets)
          owner(realpathSync(resolve(compiler.context, "node_modules", pkg)));
        for (const path of compilation.fileDependencies)
          if (path.endsWith(".css")) owner(dirname(path));
        // tw-animate-css exports only a style entry. Resolve the installed copy
        // relative to HeroUI, including when PostCSS cached its expanded CSS.
        const heroManifest = realpathSync(
          resolve(compiler.context, "node_modules/@heroui/styles/package.json"),
        );
        const styleDirectory = createRequire(heroManifest)
          .resolve.paths("tw-animate-css")
          .map((directory) => join(directory, "tw-animate-css"))
          .find((directory) => existsSync(join(directory, "package.json")));
        if (styleDirectory) owner(realpathSync(styleDirectory));

        const notices = new Map();
        function add(text, label) {
          const normalized = text.replaceAll("\r\n", "\n").trim();
          if (!normalized) return;
          if (!notices.has(normalized)) notices.set(normalized, new Set());
          notices.get(normalized).add(label);
        }
        const text = (path) => readFileSync(path, "utf8");
        const web = compiler.context;
        const missing = [];
        for (const [directory, pkg] of manifests) {
          const label = [pkg.name, pkg.version].filter(Boolean).join(" ");
          const files = readdirSync(directory, { withFileTypes: true }).filter(
            (file) =>
              file.isFile() &&
              /^(?:licen[cs]es?|copying|copyright|notices?|third[-_ ]party[-_ ](?:licenses?|notices?))(?:[-. ][\w-]+)?(?:\.txt|\.md)?$/i.test(
                file.name,
              ) &&
              !/\.(?:[cm]?[jt]sx?|map|json|html)$/i.test(file.name),
          );
          if (pkg.name === "@heroui-pro/react") {
            add(
              "HeroUI Pro components and related assets are proprietary to NextUI Inc. Used under license.",
              label,
            );
          } else if (pkg.name === "c15t" || pkg.name.startsWith("@c15t/")) {
            if (pkg.license !== "Apache-2.0")
              throw new Error("Review the changed c15t license for " + label);
            add(text(resolve(__dirname, "notices/c15t-NOTICE.txt")), label);
            add(text(resolve(__dirname, "notices/Apache-2.0.txt")), label);
          } else if (!files.length) {
            missing.push(label);
          }
          if (pkg.name !== "@heroui-pro/react") {
            for (const file of files)
              add(text(join(directory, file.name)), label);
          }
          if (pkg.name === "victory-vendor") {
            const vendor = join(directory, "lib-vendor");
            for (const entry of readdirSync(vendor, { withFileTypes: true })) {
              if (entry.isDirectory())
                add(
                  text(join(vendor, entry.name, "LICENSE")),
                  label + " / " + entry.name,
                );
            }
          }
        }
        if (missing.length)
          throw new Error(
            "Missing bundled package notices for " + missing.sort().join(", "),
          );
        add(text(resolve(web, "app/fonts/Inter-OFL.txt")), "Inter");
        add(
          text(resolve(web, "node_modules/next/dist/compiled/webpack/LICENSE")),
          "webpack browser runtime (bundled with Next.js)",
        );
        // Next copies its prebuilt legacy-browser polyfill outside the chunk graph.
        const polyfill = text(
          resolve(
            web,
            "node_modules/next/dist/build/polyfills/polyfill-nomodule.js",
          ),
        );
        const coreJs = polyfill.match(/core-js\/blob\/v([\d.]+)\/LICENSE/);
        if (!coreJs)
          throw new Error(
            "Review the licenses in Next's changed browser polyfill",
          );
        add(
          text(
            resolve(__dirname, "notices/core-js-" + coreJs[1] + "-LICENSE.txt"),
          ),
          "core-js " + coreJs[1],
        );
        const sections = [...notices]
          .map(([body, names]) => [...names].sort().join(", ") + "\n\n" + body)
          .sort();
        compilation.emitAsset(
          "static/licenses/third-party-notices.txt",
          new compiler.webpack.sources.RawSource(
            [
              "DataDeal web application — third-party notices",
              ...sections,
            ].join("\n\n────────────────────────────\n\n") + "\n",
          ),
        );
      },
    );
  });
};
