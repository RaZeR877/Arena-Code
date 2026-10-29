# Arena Code on GitHub Pages

GitHub Pages hosts **static files only**. Arena Code's full Node.js/runner stack does not run there. The `gh-pages` branch contains a **browser-only workspace** built from the project source. The website now supports:

- Local multi-file text projects, file creation/renaming/deletion, persistence in browser storage, a one-step project undo snapshot, and standard ZIP import/export (UTF-8 text only).
- Basic JavaScript and JSON parsing checks. This is **not** equivalent to executing `npm test`, bundling, linting, TypeScript language analysis, or debugging.
- Sandboxed preview of `index.html`, including local CSS stylesheets and classic JavaScript. ES module dependency imports, `npm` builds, package installs, hosted previews and server-side tests are not supported.
- Optional *on-device* WebLLM agent **suggestions** with a full before/after review dialog, explicit approval, and syntax checks. No arbitrary terminal access. A real GPU/model is required; automated tests use a mock model and do not prove coding quality.
- Four interactive starter projects, an editable single-file HTML canvas, and labeled demonstration responses.

**Safety, privacy and limits:** All work is browser-local and can disappear if browser site data is cleared. Export ZIP backups regularly. There is no remote Git synchronization, cloud account, or backend. Text projects are limited to 100 files, 400 KiB per file and 3 MiB combined. ZIP uploads are capped at 5 MiB and reject traversal, environment/secret files, invalid checksums, encrypted files and unsupported ZIP64. The AI runtime is downloaded from third-party CDNs; do not treat loading external JavaScript as a zero-risk privacy guarantee. Browser previews use opaque-origin iframes, but generated code can make outbound network requests. Do not paste credentials into generated websites.

Full functionality (accounts, real multi-user collaboration, Git operations, Docker execution, LSP and isolated builds) still requires the Node.js backend on a separate server. GitHub Pages cannot provide those services.

## One-time Pages activation

1. Open **https://github.com/RaZeR877/Arena-Code/settings/pages** while signed in as a repository administrator.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select **gh-pages** and **/(root)**, then click **Save**.
4. When GitHub reports the site is published, use **https://razer877.github.io/Arena-Code/**.

**Private repository plan limitation:** GitHub Free offers Pages on public repositories; GitHub Pro/Team/Enterprise can host Pages from eligible private repositories. If the Pages panel says the repo is not eligible, do not expose the private source to fix it without the owner's informed approval; either upgrade/adjust the GitHub plan or use an alternative static host. Even if the source repo remains private, a standard Pages site may be publicly accessible. Only the non-secret browser assets are included in the `gh-pages` branch.

## Rebuilding the publication assets

In the primary repository (`main`):

```sh
node scripts/build-pages.cjs
npm run check:pages
python3 test/pages-browser.py  # requires Python Playwright + Chromium
```

The generated contents appear in `dist/pages/`. Publish that *directory's contents* into the root of `gh-pages` (not as a nested directory). The `gh-pages` snapshot was uploaded directly for the first release. The `gh-pages` branch must be updated after a source change. For manual publication, replace its root assets with `dist/pages/` and push. For deployment using GitHub Actions rather than branch publishing, use the optional `pages-deploy.yml` workflow, which requires selecting **GitHub Actions** as the Pages source in repository settings. The workflow uploads only static assets and never packages server code or credentials.

## Backend deployment

For multi-file editing, Git, remote LSP, language servers, code execution, accounts, or live full-stack previews, host the original Node.js application with a dedicated runner as outlined in [`HOSTED_DEPLOYMENT.md`](HOSTED_DEPLOYMENT.md). GitHub Pages cannot provide those services by itself.
