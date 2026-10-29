# Arena Code on GitHub Pages

GitHub Pages hosts **static files only**. Arena Code's full Node.js/runner stack does not run there. The `gh-pages` branch contains a safe, browser-only version of the existing interface, including:

- Four interactive starter projects and an editable single-file HTML canvas.
- Clearly labeled, illustrative demo comparisons (no model/API connection).
- Optional browser-local WebLLM inference, requiring a supported WebGPU browser and a sizable third-party model download. This route has not been validated end-to-end on every client GPU.
- Local browser conversation history and canvas revisions. Browser storage is not cloud synchronization.
- No server-side project/file APIs, login, Docker execution, autonomous coding agent, hosted preview API, or backend credentials. These intentionally display a notice directing users to the full application.

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
node --test test/pages.test.cjs
```

The generated contents appear in `dist/pages/`. Publish that *directory's contents* into the root of `gh-pages` (not as a nested directory). The `gh-pages` snapshot was uploaded directly for the first release. Later changes to `main` do **not** automatically update the static `gh-pages` branch; rebuild and republish when you want a new Pages release.

## Backend deployment

For multi-file editing, Git, remote LSP, language servers, code execution, accounts, or live full-stack previews, host the original Node.js application with a dedicated runner as outlined in [`HOSTED_DEPLOYMENT.md`](HOSTED_DEPLOYMENT.md). GitHub Pages cannot provide those services by itself.
