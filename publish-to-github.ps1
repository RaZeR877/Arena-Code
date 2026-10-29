[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidatePattern('^[A-Za-z0-9_.-]{1,100}$')]
    [string]$RepositoryName = 'Arena-Code',

    [Parameter(Position = 1)]
    [ValidateSet('Private', 'Public')]
    [string]$Visibility = 'Private'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. Install Git and GitHub CLI (gh), then rerun this script."
    }
}

Assert-Command 'git'
Assert-Command 'gh'

if (-not (Test-Path -LiteralPath (Join-Path $PWD 'package.json')) -or
    -not (Test-Path -LiteralPath (Join-Path $PWD 'server.js')) -or
    -not (Test-Path -LiteralPath (Join-Path $PWD 'IMPLEMENTATION_STATUS.md'))) {
    throw 'Run this script from the extracted Arena Code project folder. Required project files were not found.'
}
if (Test-Path -LiteralPath (Join-Path $PWD '.git')) {
    throw 'This folder already contains a .git directory. To avoid overwriting another repository, publish from a clean extraction of the Arena Code ZIP.'
}

$authOutput = & gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login' first. Details: $($authOutput -join ' ')"
}
$user = (& gh api user | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or -not $user.login) { throw 'Could not determine the authenticated GitHub account.' }
$owner = [string]$user.login
$fullName = "$owner/$RepositoryName"

# Check for an existing repository first. This script is intentionally create-only.
$null = & gh repo view $fullName --json name 2>$null
if ($LASTEXITCODE -eq 0) {
    throw "Repository $fullName already exists or is accessible. This create-only script will not push to it. Use a new repository name."
}

# Refuse likely credential/private-key files even if a user accidentally copied one into the folder.
$blockedNames = @('.env', '.npmrc', '.pypirc', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa')
$files = Get-ChildItem -LiteralPath $PWD -File -Recurse -Force | Where-Object {
    $_.FullName -notmatch '[\\/](node_modules|data|test-results|\.git)[\\/]'
}
$unsafe = @($files | Where-Object {
    ($blockedNames -contains $_.Name.ToLowerInvariant()) -or
    ($_.Name -like '.env.*' -and $_.Name -ne '.env.example') -or
    ($_.Extension -in @('.pem', '.key'))
})
if ($unsafe.Count -gt 0) {
    $names = ($unsafe | ForEach-Object { $_.FullName.Substring($PWD.Path.Length + 1) }) -join ', '
    throw "Potential secret/key files found. Remove them before publishing: $names"
}

Write-Host "Validating Arena Code before publishing to $fullName ($Visibility)..."
& npm run ci
if ($LASTEXITCODE -ne 0) { throw 'CI checks failed; the repository will not be created or pushed.' }

& git init -b main
if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }
$gitName = if ($user.name) { [string]$user.name } else { $owner }
$gitEmail = "$($user.id)+$owner@users.noreply.github.com"
& git config user.name $gitName
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the local Git author name.' }
& git config user.email $gitEmail
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the local Git author email.' }
& git add --all
if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
& git commit -m 'Initial release: Arena Code 0.4.0'
if ($LASTEXITCODE -ne 0) { throw 'Initial Git commit failed.' }

$visibilityFlag = if ($Visibility -eq 'Public') { '--public' } else { '--private' }
& gh repo create $fullName $visibilityFlag --source . --remote origin --push --description 'Local-first AI coding workspace and guarded coding agent'
if ($LASTEXITCODE -ne 0) { throw 'GitHub repository creation or push failed. The local Git commit is preserved; inspect gh output before retrying.' }

Write-Host ''
Write-Host 'Published successfully:' -ForegroundColor Green
Write-Host "https://github.com/$fullName"
Write-Host 'The repository was created only after tests passed and secret-file checks succeeded.'
