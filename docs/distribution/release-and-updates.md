# Releasing, signing, updating and distributing IGrasp

How to ship IGrasp so anyone can install it, trust it, and receive updates without downloading a new
package by hand. Status: packaging exists; code signing and auto-update are **not implemented yet**.

## What exists today

`.github/workflows/build.yml` runs on every `v*` tag. It builds the Windows installers (NSIS `.exe`
and `.msi`) and the Linux installers (`.AppImage` and `.deb`) and attaches them to a **draft** GitHub
Release. A maintainer reviews and publishes it by hand. The installers are currently **unsigned**.

## 1. A release people can trust

### Windows

Unsigned installers trigger SmartScreen ("Windows protected your PC") and many people stop there.
Options:

- **Azure Trusted Signing** (about $10/month): the cheapest legitimate route, builds reputation
  quickly. Needs an Azure account and identity validation.
- **OV or EV code-signing certificate** from a CA (Sectigo, SSL.com, DigiCert), roughly $200-500 per
  year. EV removes the SmartScreen warning immediately. Certificates now live on hardware tokens or
  cloud HSMs, so CI signing goes through the CA's cloud signing service.
- **SignPath Foundation**: free signing for open-source projects (public repo and OSS licence).

Tauri signs during the build when `bundle.windows.signCommand` (or a certificate thumbprint) is set in
`tauri.conf.json`. In CI, pass the credentials as secrets.

### Linux

No gatekeeper. Ship the `.deb` and `.AppImage`, add a `SHA256SUMS` file to the release, and optionally
GPG signatures.

### macOS

Not a target. It would need a $99/year Apple Developer account plus notarization.

## 2. Updates without re-downloading

Use Tauri's **updater plugin**. It is separate from code signing and mandatory for updates: updates
must be signed with a Tauri key pair.

1. Generate the key pair: `npm run tauri signer generate -w ~/.tauri/igrasp.key`.
2. Keep the private key and its password secret. If they are lost, installed apps can never update
   again. Store them as GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Add `tauri-plugin-updater` (Rust) and `@tauri-apps/plugin-updater` (JS). Only `ipc/tauri.ts` may
   touch `@tauri-apps/*`, so wrap it there as `checkForUpdate` and `installUpdate` on the `Backend`
   interface, and mirror both in `ipc/mock/`.
4. In `tauri.conf.json` add:
   - `bundle.createUpdaterArtifacts: true`
   - `plugins.updater.pubkey` set to the public key
   - `plugins.updater.endpoints` set to
     `["https://github.com/jean3978/IGrasph/releases/latest/download/latest.json"]`
   - `plugins.updater.windows.installMode` set to `"passive"`
5. Add `uploadUpdaterJson: true` to `tauri-action`, so `latest.json` and the `.sig` files are uploaded
   with each release.

How it works for users: the app fetches `latest.json` and compares versions. If a newer one exists it
downloads the installer, verifies the signature against the embedded public key, installs and
relaunches. AppImage updates itself in place. A `.deb` install cannot self-update; those users use an
apt route or download the new `.deb`.

### Fit with the project rules

Nothing the app does may run on its own, so do not check at startup. Trigger the check from a "Check
for updates..." menu item in `menuActions.ts`. Automatic checks, if wanted later, must be an opt-in
setting because they are a network call. Record an ADR in `docs/decisions/` and a `CHANGELOG.md`
entry.

## 3. Distribution

- **GitHub Releases** (current): free, and doubles as the update server. `latest/download` only
  resolves for *published* releases, not drafts. Release assets must be public, since a private
  repo's updater endpoint needs auth.
- **A download page**: GitHub Pages or the README, linking to `releases/latest`.
- **winget**: submit a manifest PR to `microsoft/winget-pkgs` so users can run
  `winget install IGrasp`. Needs a stable installer URL; signing helps. `wingetcreate` or the
  `winget-releaser` action automate it per release.
- **Scoop / Chocolatey** (optional), and **Flathub** or an apt repo for Linux if there is demand.
- **Microsoft Store** (optional): $19 one-time fee; handles signing and updates but uses MSIX and has
  its own review.

## Release flow once set up

1. Bump the version in `package.json` (`tauri.conf.json` reads it from there).
2. Update `CHANGELOG.md`.
3. Merge to `main`.
4. Tag `vX.Y.Z` and push the tag (only when the maintainer asks).
5. CI builds, signs and drafts the release.
6. Test the installers, then publish. Existing users see the update on their next check.

## Suggested order

1. Add the updater first: free and fully in our control.
2. Start the signing process (Azure Trusted Signing or SignPath) in parallel; identity validation
   takes days.
3. Add winget last.
