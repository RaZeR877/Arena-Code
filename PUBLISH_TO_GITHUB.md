# Publish Arena Code to a new GitHub repository

The connected GitHub integration available in the preparation environment can write to existing repositories but does not expose the GitHub **create repository** action. This helper publishes the source from your own computer using your authenticated GitHub CLI session instead.

## Windows

1. Install [Git for Windows](https://git-scm.com/download/win) and [GitHub CLI](https://cli.github.com/).
2. Open PowerShell and run `gh auth login` once. Confirm that `gh auth status` succeeds.
3. Extract this ZIP and open the `arena-code` directory.
4. Double-click `publish-to-github.bat`. The default is a **private** repository named `Arena-Code` under the logged-in account.
5. To choose a different repository name, run `.\publish-to-github.ps1 My-Arena-Code`. For a public repo, run `.\publish-to-github.ps1 My-Arena-Code Public`.

The script checks that it is in the correct project, refuses a folder that already has `.git`, scans for common secret/key files, runs `npm run ci`, creates a local Git commit, then asks GitHub CLI to create a new repository and push. It deliberately refuses to push into an existing repository. The local commit is retained if the remote create/push step fails.

## macOS / Linux

Install Git and GitHub CLI, run `gh auth login`, then from the extracted project directory you can use the same PowerShell script if PowerShell 7 is installed:

```powershell
pwsh -File ./publish-to-github.ps1 Arena-Code Private
```

If you prefer regular Git commands, create a new empty GitHub repository, then run `git init -b main`, `git add --all`, `git commit -m "Initial release: Arena Code 0.4.0"`, `git remote add origin https://github.com/YOUR_ACCOUNT/Arena-Code.git`, and `git push -u origin main`.

**Security:** keep the repository private unless you have reviewed the full commit contents. The helper blocks common credential file names, but no automated secret scan can guarantee that every kind of secret has been detected.
