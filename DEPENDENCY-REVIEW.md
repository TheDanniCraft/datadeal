# Release dependency review

Reviewed on November 25, 2026, with Bun 1.4.2. The inventory covers all 497 external package versions in `bun.lock` at SHA-256 `02a1cf0fb7271e2820d7349c1dd821ddf2e85c28b0409abeb423d0afa8798a36`. [Package inventory](licenses/dependencies.csv)

## What was examined

Windows x64 installed 376 distinct package versions and Ubuntu x64 installed 383. Together these installations supplied 390 distinct manifests. For the remaining 107 optional dependencies, the review used the published npm manifest for the exact package and version and matched its tarball integrity to the lock. The CSV identifies the source of each license declaration. Browser binaries installed separately by Playwright and operating-system packages are outside the Bun inventory.

Full and production-only registry audits initially reported one high-severity advisory. HeroUI’s install CLI pinned `figlet@1.11.0`. The parent-specific override resolves it to `1.11.3`. Both audits returned zero published advisories against the revised lock. The installed licensed HeroUI components loaded successfully. Recheck the dated result when preparing a release. [Upstream advisory](https://github.com/advisories/GHSA-62ch-8vmq-8xm7)

## What ships

- **Web client.** The production Terms page links to the notices for bundled modules, styles, browser runtime and Inter. The build includes c15t’s upstream attribution, the D3 licenses shipped by Victory, and the license for the core-js version embedded in Next’s legacy browser polyfill. [c15t notice](https://raw.githubusercontent.com/c15t/c15t/main/NOTICE) · [Apache License](https://www.apache.org/licenses/LICENSE-2.0) · [core-js license](https://github.com/zloirock/core-js/blob/v3.38.1/LICENSE)
- **Standalone server.** Keep the installed license and notice files alongside the traced packages. The native sharp packages include libvips and platform-specific third-party notices. The mix of native binaries and licenses depends on the operating system and architecture. Inspect the final host artifact when building a new target. [sharp dependencies](https://sharp.pixelplumbing.com/install/)
- **Browser extensions.** The Chrome and Firefox packages include notices for the JavaScript entry points, public HeroUI components, styles, Inter, build-runtime helpers and the Public Suffix List. Their reviewer source archive uses the public dependency graph. [Notice index](apps/extension/public/THIRD-PARTY-NOTICES.md) · [Release instructions](apps/extension/SUBMISSION.md)
- **Commercial tooling.** The web app uses `@heroui-pro/react` under its project license. Its `heroui-pro` installation CLI declares `UNLICENSED`. Keep the licensed package, credentials and install cache private. Confirm the owner’s Web or Super entitlement for the installed version before release. [HeroUI licensing](https://heroui.pro/docs/react/getting-started/licensing) · [HeroUI terms](https://heroui.pro/terms)

Other declared licenses worth tracking on a dependency update include MPL-2.0 for Lightning CSS, CC-BY-4.0 for the caniuse-lite dataset and EPL-2.0 for the Zowe keyring dependency. The package inventory covers build-time and optional packages as well as application dependencies. The shipped notices are derived separately from release output.

The Compose worker's [Chromium seccomp profile](deploy/chromium-seccomp.json) is adapted from Playwright 1.65.1's Docker profile under Apache-2.0. It also permits the Chromium zygote to use `chroot` in its user namespace with outer container capabilities dropped. [Upstream profile](https://github.com/microsoft/playwright/blob/v1.65.1/utils/docker/seccomp_profile.json) · [Apache license text](apps/web/scripts/notices/Apache-2.0.txt)

## Repeating the review

Run these commands in a clean installation with the intended release platform and lockfile. Compare the resulting package names, versions and licenses with the inventory. Inspect new vendored libraries and font assets even when the top-level dependency name stays the same.

```sh
bun --no-env-file install --frozen-lockfile
bun --no-env-file pm licenses --json
bun --no-env-file audit --json --audit-level=low
bun --no-env-file audit --prod --json --audit-level=low
```

Build the standalone server and open the notice link from `/terms`. Build the store ZIPs and reproduce their extracted contents using the reviewer source archive. When distributing a server image, review its base system and Chromium distribution separately.
