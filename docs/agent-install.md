# Agent installation and configuration

Runbook for installing **`dsh-model-usage`** (this repository) into a DeepSeek Harness profile from a
terminal or desktop agent such as Claude Code, Codex or the Harness's own agent.

The plugin needs no configuration once installed: its dashboard is read-only and derives everything
from the profile's own session logs. Two steps are human by design and are marked **[human]**:
closing the Desktop application and triggering **restartHost**. Do not attempt to automate or work
around them.

Companion documents: [README.md](../README.md) for what the dashboard shows and how it counts, and
[packages/plugin/THIRD_PARTY_NOTICES.md](../packages/plugin/THIRD_PARTY_NOTICES.md) for attribution.

## 1. Scope and agent roles

| Agent | Can do | Must not do |
| --- | --- | --- |
| Terminal agent (Claude Code, Codex CLI, `dsh headless`) | Everything except the marked human steps. | Start a replacement Web server, patch the application, edit the profile by hand. |
| Desktop agent (running inside the DeepSeek Harness Desktop host) | Clone/pull, `npm ci`, `npm run check`, `npm run pack:plugin`, compute the digest, hand off the install command. | Quit or restart its own host, so it cannot run the profile install itself. Delegate steps 4-6 to a terminal or the user. |

Installing a plugin writes into the target Harness profile. Source edits and `npm run pack:plugin`
alone never change an installed profile.

## 2. Prerequisites

- Node.js 24. The repository pins it in [.nvmrc](../.nvmrc): run `nvm use` (Windows: `nvm use 24`).
- npm, to restore and build the workspace.
- A DeepSeek Harness installation on the target machine. The Windows Desktop build is the only
  platform with recorded validation for this package.
- For the `desktop` profile, the CLI bundled with the installed application. The `desktop` profile
  is reserved for the Electron application; a generic `dsh` refuses it.
- The **Harness home** is `~/.dsh` (`%USERPROFILE%\.dsh` on Windows) unless the `DSH_HOME`
  environment variable overrides it. Everything below refers to it as `<DSH_HOME>`.

## 3. Build, test and pack

Run from the repository root:

```sh
nvm use
npm ci
npm run check          # builds Host, generated RPC and Client, then runs the suite
npm run pack:plugin    # emits dsh-model-usage-<version>.tgz in the repository root
```

`npm run check` must pass before packing. The suite runs on Node's own type stripping, without a
loader, a build step or a child process; it never touches a real profile.

Derive the artifact path from the manifest instead of hardcoding a version:

**Windows (PowerShell)**

```powershell
$version = (Get-Content .\packages\plugin\package.json -Raw | ConvertFrom-Json).version
$tarball = Join-Path (Get-Location) "dsh-model-usage-$version.tgz"
$digest  = (Get-FileHash -Algorithm SHA256 $tarball).Hash
"$tarball`n$digest"
```

**macOS**

```sh
version=$(node -p "require('./packages/plugin/package.json').version")
tarball="$PWD/dsh-model-usage-$version.tgz"
shasum -a 256 "$tarball"
```

Record the absolute path and the digest. Keep the previously installed tarball: it is the rollback
artifact. If you change the sources, bump the version in `packages/plugin/package.json` before
packing; a same-version tarball at the same path can be served from the package manager's cache.

## 4. Install into the target profile

The Desktop profile must have been initialized by opening the application once, and the application
must be **fully quit** before the command runs: the profile is written under a file lock, and the
launcher's own message requires the application to be closed.

**[human]** Quit DeepSeek Harness Desktop completely.

**Windows Desktop** — use the bundled CLI, not a checkout launcher:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "$tarball"
```

**macOS Desktop**

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$tarball"
```

The command forwards its remaining arguments to the profile's package manager. On success it adds
the `file:` dependency to `<DSH_HOME>/profiles/desktop/package.json` and appends `dsh-model-usage` to
`dsh.profile.bundles`, because the package declares `dsh.bundle`.

## 5. Reactivate the host

**[human]** Run the application's **restartHost** action, then reload the existing UI at
`http://127.0.0.1:19387`.

A browser refresh alone cannot activate new Host fields or a new cache schema, and the generated
Remote registry is discovered at startup. Never start a replacement server to "apply" the change.

## 6. Verify the installation

**Windows (PowerShell)**

```powershell
$profile = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\package.json'
Get-Content $profile
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop why dsh-model-usage
```

**macOS**

```sh
cat ~/.dsh/profiles/desktop/package.json
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop why dsh-model-usage
```

Expected state:

- `dependencies["dsh-model-usage"]` is `file:<absolute path to the installed tarball>`.
- `dsh.profile.bundles` contains `dsh-model-usage`.
- `why` resolves the package from the profile tree.
- `plugin --profile desktop version-exemptions` prints the profile's exemptions (empty is normal).

Then confirm in the UI: the button at the sidebar foot opens the usage dashboard, and the
**Back to conversation** button in its header returns to the conversation. A file present in the
profile is not proof the plugin loaded; only the restarted Host shows that.

Optionally cross-check the numbers against the Host's own cache:

```sh
npm run verify:usage
npm run verify:usage -- --cache "<DSH_HOME>/profiles/desktop/.cache/dsh-model-usage/usage-v1.json"
```

This recounts persisted logs independently. Live sessions and activity persisted after the last scan
can differ in either direction, so compare against an idle profile before concluding that the
counting is wrong.

## 7. Configuration

None. The plugin has no settings UI, no credentials and no network access. It reads the profile's
durable session logs, caches its fold at
`<DSH_HOME>/profiles/<profile>/.cache/dsh-model-usage/usage-v1.json` (schema 4, per-session), and
serves the aggregate over the Remote contract.

- An older cache schema is discarded and rebuilt automatically after the updated Host loads; no
  manual cache cleanup is required.
- The dashboard always covers a fixed 365-day window ending today; there is no period selector and
  nothing to configure per profile.
- If the sibling plugin `dsh-chatgpt-plan` is installed, its provider usage appears in the breakdown
  with no extra configuration.

## 8. Rollback

Reinstall the retained previous tarball through the same bundled CLI and profile, then repeat the
**restartHost** and UI reload. The previous Host rebuilds the cache if the schema changed:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "C:\path\to\previous\dsh-model-usage-<previous-version>.tgz"
```

To remove the plugin entirely, run `plugin --profile desktop remove dsh-model-usage` and restart the
host; the manager drops the now-unused `dsh.profile.bundles` entry on its own.

Deleting the cache directory is never required for a rollback; it is derived state.

## 9. Secondary path: Web and custom profiles

This path is **not validated** for the current release. It uses a generic `dsh` launcher, which
requires `pnpm` on `PATH`; without it the command exits with `127` and reports that pnpm was not
found. A non-desktop profile is initialized from its template on first use.

```sh
dsh plugin --profile web add /absolute/path/dsh-model-usage-<version>.tgz
```

For a new, separate custom profile, initialize it from the shipped Web template first:

```sh
dsh --profile my-web --from-default-profile web --dump-config
dsh plugin --profile my-web add /absolute/path/dsh-model-usage-<version>.tgz
dsh --profile my-web --no-open --port 41873
```

`--from-default-profile` initializes a new profile; it does not repair an existing profile's bundle
list.

## 10. Failure modes

| Symptom | Cause | Action |
| --- | --- | --- |
| `installation rejected: ...` and exit code 1 | The package's declared DSH range is incompatible with the running Harness and is not exempted. The manager restores `package.json` and `pnpm-lock.yaml`, reinstalls the previous tree, and reports separately if `node_modules` could not be reinstalled. | Install was rolled back on purpose. Either install a build whose range matches the running Harness, or approve the exact pair with `plugin --profile <p> allow-version dsh-model-usage@<version> --dsh-version <exact> --accept-risk`. Never widen the declared range just to bypass the check. |
| `dsh: pnpm was not found` and exit code 127 | Generic CLI used outside the Desktop bundle, with no `pnpm` on `PATH`. | Use the bundled CLI for the `desktop` profile, or install pnpm for the secondary path. |
| `dsh: Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it` | The `desktop` profile does not exist yet, or the application is running. | **[human]** Open the application once, quit it completely, retry. |
| `dsh: warning: <name> declares no dsh.bundle` | The package was installed as a plain dependency and is not a profile layer. | Expected only for unrelated packages. `dsh-model-usage` does declare `dsh.bundle`; a build that lost it is broken. |
| The installed version does not change | Same version and path as a previously installed tarball, served from the package manager cache. | Bump the version, repack and reinstall. Keep artifacts digest-addressed. |
| The sidebar button is missing after install | The Host was not restarted, or the browser was only refreshed. | **[human]** Run **restartHost** and reload the UI. |
| `verify:usage` disagrees with the dashboard | Live sessions or activity persisted after the last scan. | Let the profile go idle, refresh the dashboard and compare again. |

## 11. Boundaries

- Do not edit `<DSH_HOME>/profiles/*/package.json`, `pnpm-lock.yaml` or `node_modules` by hand; the
  plugin manager owns them.
- Do not patch the application ASAR/core, a Pi or WSL installation, or any installed package.
- Do not delete, hand-edit or commit the usage cache or the session logs it derives from.
- Do not commit tarballs, deployment receipts or machine-specific paths. Deployment evidence belongs
  in a `*.local.md` file, which is git-ignored.

## Related

The sibling plugin `dsh-chatgpt-plan` is the provider whose configured models appear in this
dashboard's breakdown, and is installed the same way. Both can coexist in one profile.
