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
- Write access to `/Applications/Claude.app` (the default for a user-installed app).

## Install

> 🟥 **Run this from the macOS _Terminal_ app — NOT from a terminal inside Claude
> Desktop (e.g. Claude Code running in the desktop app).** The installer quits
> Claude Desktop; if you run it from within Claude, you'll kill your own session.

```sh
git clone https://github.com/NitzanBar1/claude-desktop-rtl-mac.git
cd claude-desktop-rtl-mac
npm install

# Fully quit Claude Desktop (⌘Q) first, then:
node patch.mjs
```

Reopen Claude Desktop. Hebrew/Arabic messages should now align right-to-left.

### Try it safely first (optional)

A dry run builds and verifies a patched archive in a temp folder **without
touching the installed app** (safe to run while Claude is open):

```sh
node patch.mjs --dry-run
```

## Uninstall

```sh
# Quit Claude Desktop first, then:
node unpatch.mjs
```

This restores the original `app.asar` and `Info.plist` from the backups the
installer made and re-signs the bundle. To get the *original notarized* build
back, reinstall Claude from <https://claude.ai/download>.

## Surviving updates

Claude Desktop auto-updates and each update replaces the app bundle, removing the
patch (and its backups). After an update, just quit Claude and run `node patch.mjs`
again.

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

| File          | Purpose                                                        |
|---------------|----------------------------------------------------------------|
| `rtl.js`      | RTL auto-detector injected into the claude.ai page             |
| `rtl.css`     | Injected stylesheet (alignment; forces code/math LTR)          |
| `patch.mjs`   | Installer (backup → inject → repack → fix integrity → re-sign) |
| `unpatch.mjs` | Uninstaller (restore backups → re-sign)                        |

## License

[MIT](LICENSE) © 2026 Nitzan Bar
