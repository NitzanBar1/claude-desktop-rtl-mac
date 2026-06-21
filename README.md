# Claude Desktop RTL Patch (macOS)

Adds proper right-to-left (Hebrew / Arabic) support to **Claude Desktop on macOS**.
It auto-detects RTL text in Claude's responses and in the message composer and
aligns the direction in real time — including while answers are streaming — while
keeping code blocks and math left-to-right.

This is a macOS counterpart to the Windows-only
[shraga100/claude-desktop-rtl-patch](https://github.com/shraga100/claude-desktop-rtl-patch).
The macOS app is built completely differently (see [How it works](#how-it-works)),
so this is a separate implementation, not a port.

> ⚠️ **This modifies the Claude Desktop app bundle and replaces its notarized
> Apple code signature with a local ad-hoc one.** It is unofficial and not
> affiliated with Anthropic. Use at your own risk and review Anthropic's Terms of
> Service first. See [Caveats](#caveats).

---

## What it does

- Real-time RTL detection by first-strong character, robust to leading URLs,
  file paths, numbers and bullets.
- Works on streamed responses (a `MutationObserver` re-tags content as it arrives).
- Keeps `code`, `pre`, and KaTeX math left-to-right inside RTL paragraphs.
- Aligns the composer (textarea / contenteditable) live as you type.
- Only tags elements it is sure about, so it never fights Claude's own layout.

## Requirements

- macOS with **Claude Desktop** installed at `/Applications/Claude.app`.
- **Node.js 18+** (`node` and `npm` on your `PATH`).
- Permission to modify the app bundle. On macOS Sonoma+ the **App Management**
  privacy control governs this. If you install from **Terminal**, grant it once:
  *System Settings → Privacy & Security → App Management → enable for Terminal*,
  then quit & reopen Terminal. (The Claude Code path usually already has access.)
  If signing is ever blocked, the installer **rolls the app back automatically** —
  it never leaves Claude in a broken state (see [Safety](#safety)).

## Install

### Option 1 — Let Claude Code do it (no Terminal) ⭐

Open Claude Code (inside the Claude Desktop app is fine) and tell it:

> Install this for me: https://github.com/NitzanBar1/claude-desktop-rtl-mac

Claude Code will clone the repo and run `install-auto.sh`, which **detaches from
the app** and then quits Claude, applies the patch, re-signs, and relaunches
Claude — entirely on its own. Your Claude Code session pauses while Claude
restarts (~30–60s) and resumes afterward. The agent verifies the result from
`/tmp/claude-rtl-install.log`. See [`CLAUDE.md`](CLAUDE.md) for the exact agent
steps.

Why a detached helper? Claude Code running inside Claude Desktop can't quit/re-sign
its own host without killing its session. `install-auto.sh` solves that by
re-launching itself in its own process session that survives the restart.

### Option 2 — Manual (Terminal)

> 🟥 Run this from the macOS **Terminal** app — NOT from a terminal inside Claude
> Desktop. The installer quits Claude Desktop; from within Claude you'd kill your
> own session.

```sh
git clone https://github.com/NitzanBar1/claude-desktop-rtl-mac.git
cd claude-desktop-rtl-mac
npm install

node patch.mjs --dry-run   # optional: builds + verifies in a temp dir, app untouched
# then fully quit Claude Desktop (⌘Q) and:
node patch.mjs
```

Reopen Claude Desktop. Hebrew/Arabic messages should now align right-to-left.

`install-auto.sh` works from a normal terminal too (`bash install-auto.sh`); it
just isn't required there.

## Uninstall

Hands-off (via Claude Code or any shell) — same detached restart flow:

```sh
bash install-auto.sh uninstall
```

Or manually, with Claude Desktop quit, from Terminal: `node unpatch.mjs`.

Either restores the original `app.asar` and `Info.plist` from the backups the
installer made and re-signs the bundle. To get the *original notarized* build
back, reinstall Claude from <https://claude.ai/download>.

## Surviving updates

Claude Desktop auto-updates and each update replaces the app bundle, removing the
patch (and its backups). After an update, just reinstall — `bash install-auto.sh`
(or tell Claude Code to install it again).

## How it works

On macOS the Claude Desktop main window is a thin wrapper that loads **claude.ai**
remotely into an Electron `WebContentsView` — the chat UI is not in the local
bundle. So instead of editing renderer files, the patch injects a hook into the
**main process** entry (`.vite/build/index.pre.js` inside `app.asar`):

```js
app.on("web-contents-created", (_e, wc) => {
  const inject = () => { wc.insertCSS(CSS); wc.executeJavaScript(JS); };
  wc.on("dom-ready", inject);
  wc.on("did-frame-finish-load", inject);
});
```

`insertCSS` / `executeJavaScript` run outside the page's Content-Security-Policy,
so the RTL logic (`rtl.css` + `rtl.js`) reaches the remote claude.ai content.

Because `app.asar` changes, the installer also:

1. Recomputes the ASAR header SHA-256 and updates `ElectronAsarIntegrity` in
   `Info.plist` (macOS enforces ASAR integrity).
2. Re-packs preserving the exact set of unpacked native binaries
   (`.node` / `.dylib` / `spawn-helper`), with a verification gate that aborts if
   that set changes.
3. Ad-hoc re-signs the top-level bundle (`codesign --sign -`). The nested helper
   apps keep their original Anthropic signatures.

## Safety

The installer is fail-safe. Before changing anything it backs up the original
`app.asar`, `Info.plist`, main executable and `_CodeSignature` to
`~/Library/Application Support/claude-rtl-patch/` (outside the bundle). The
destructive steps (swap → integrity hash → re-sign) are atomic: if **any** of
them fails — including macOS blocking `codesign` — the app is restored to the
**byte-identical, still-notarized** original by plain file copy (no `codesign`
needed). This has been verified end-to-end on a throwaway copy: install,
uninstall, and a simulated mid-install signing failure all leave a valid bundle.

If Claude somehow still won't launch, reinstalling from
<https://claude.ai/download> always restores a clean app.

## Caveats

- **Signature:** the bundle is re-signed ad-hoc, so it is no longer notarized by
  Anthropic. It still launches because it was already de-quarantined.
- **Hardened runtime:** ad-hoc signing drops the hardened runtime, which is
  necessary so the ad-hoc binary can load Anthropic-signed frameworks.
- **Entitlements:** the team-scoped `keychain-access-groups` entitlement
  (used for passkey / WebAuthn login) is dropped. Email/SSO login is unaffected.
- This is a heuristic, best-effort UI tweak. It does not touch your data or how
  Claude works — only text direction in the UI.

## Files

| File              | Purpose                                                          |
|-------------------|------------------------------------------------------------------|
| `install-auto.sh` | Detached install/uninstall orchestrator (no-Terminal path)       |
| `CLAUDE.md`       | Step-by-step install instructions for a Claude Code agent         |
| `patch.mjs`       | Installer (backup → inject → repack → fix integrity → re-sign)    |
| `unpatch.mjs`     | Uninstaller (restore backups → re-sign)                          |
| `rtl.js`          | RTL auto-detector injected into the claude.ai page               |
| `rtl.css`         | Injected stylesheet (alignment; forces code/math LTR)            |

## License

[MIT](LICENSE) © 2026 Nitzan Bar
