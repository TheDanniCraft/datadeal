# DataDeal browser extension release

The Chrome and Firefox packages open a privacy report for the active website. Opening the popup sends the registrable domain to `https://datadeal.app`. Visitors can also enable automatic scores for a particular HTTPS host. After opt-in, eligible visits on that host send its registrable domain to the public report endpoint. The separate privacy-preference lookup can use an existing DataDeal session. It sends no active-tab URL. Reports link to dated evidence, and the popup works for guests.

## Build artifacts

From the project root with dependencies installed, run in PowerShell:

```powershell
$env:NODE_ENV = 'production'
bun --no-env-file run --cwd apps/extension package
```

Use the three files from the **same** run in `apps/extension/.output`:

| Suffix         | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `-chrome.zip`  | Chrome Web Store package, Manifest V3                           |
| `-firefox.zip` | Firefox AMO package, Manifest V2                                |
| `-sources.zip` | Human-readable extension source and build inputs for AMO review |

The version comes from `apps/extension/package.json`. Increase it before submitting an update to an existing release. WXT's regular `build` command rebuilds the unpacked directories. The `package` command installs the frozen reviewer dependency graph into a temporary workspace and builds both unpacked targets and all three ZIPs from it. This makes the release independent of older packages in a developer's existing install. A previously created ZIP can contain older code despite a successful regular build.

## Reviewer rebuild

Extract the source ZIP into an empty directory. Use Node.js 24.19 and Bun 1.4.2. The archive includes the two workspaces used by the extension and their frozen Bun dependency graph. From the extracted root on Linux, run:

```sh
bun --no-env-file install --frozen-lockfile
NODE_ENV=production bun --no-env-file run --cwd apps/extension build
```

This builds Firefox in `apps/extension/.output/firefox-mv2` and Chromium in `apps/extension/.output/chrome-mv3`. The popup uses the public HeroUI v3 and Tailwind packages, shared DataDeal Mouve tokens, and the bundled Inter font. Its font license is included in both release archives. Public dependencies suffice for this extension-only workspace. Compare the paths and individual file bytes against the unpacked store ZIP. This comparison also checks the manifest, HTML chunk references and icon assets across operating systems. Firefox requires reproducible sources and build instructions for bundled or minified extensions. [Mozilla source-code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)

## Store review notes

### Check the packaged notices

Open `THIRD-PARTY-NOTICES.md` in each store ZIP. Its three JavaScript inventories are generated from the modules in that target's popup, background and form-reminder bundles. The accompanying texts cover WXT, the CSS imports, runtime helpers, suffix data and Inter. The source ZIP contains the attribution index and supplemental upstream notices. The frozen install and build regenerate the remaining notices offline from the installed packages. Include these files in the byte comparison above. When updating tldts, also update the pinned link to its generated suffix table. [Vite license generation](https://vite.dev/config/build-options.html#build-license)

- **Single purpose.** Help visitors understand a website's privacy practices before they register or check out. Explain the score, evidence, published scan date and limitations. Describe optional site reminders in the listing when included in the packaged manifest.
- **Permissions and data.** `activeTab` lets the user open the current site's report. Required DataDeal host access retrieves the report and saved privacy preference. `storage` preserves site-specific opt-ins locally. `scripting` places an existing report score beside relevant forms on specifically approved sites. The optional HTTPS origin pattern lets the popup request the chosen hostname at runtime. Explain that the form detector checks structure locally. Enabling site scores allows a domain-only report lookup on later visits to that host. A published rating can appear on the toolbar icon. The public report lookup sends the registrable domain without the page path, query, fragment or form entries.
- **Browser checks.** Inspect both packaged manifests. Load the Chrome directory at `chrome://extensions` with **Load unpacked**. In Firefox, use `about:debugging` → **This Firefox** → **Load Temporary Add-on** and select the built manifest. Open a published domain and an unscanned domain. Check the score, warning order, source links and scan-request link. For the reminder feature, check explicit grant, dismissal, revocation and isolation from other sites. Review the network requests and the Firefox install disclosure. An end-to-end release lookup requires the real HTTPS API and privacy page to be accessible.
- **Chrome Web Store.** In the Developer Dashboard create the new item and select the Chrome ZIP. Provide a descriptive listing, a current 1280 × 800 screenshot and the 440 × 280 promotional tile. In **Privacy practices**, explain each manifest permission, declare the domain lookup and any signed-in account use, and link to the public privacy policy reflecting the extension's actual behavior. Complete distribution settings and choose the desired publication timing before submitting. [Chrome submission](https://developer.chrome.com/docs/webstore/publish) · [Listing assets](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) · [Privacy declarations](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- **Firefox AMO.** In Developer Hub choose **Submit a New Add-on** and the listed distribution channel for a public listing. Upload the Firefox ZIP, read the validator results, and attach the source ZIP at the source-code prompt. Point reviewers to this guide inside the archive. The Gecko manifest declares `browsingActivity` because the popup sends the active domain. Complete the listing, privacy disclosures and reviewer notes with an accessible published report they can independently open. [Mozilla submission](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
