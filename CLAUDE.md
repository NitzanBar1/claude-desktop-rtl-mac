# Instructions for Claude Code: installing this patch

This repo patches **Claude Desktop on macOS** to add Hebrew/Arabic right-to-left
support. If the user asks you to install it, follow these steps **exactly**.

## Critical context

You (Claude Code) are almost certainly running **inside Claude Desktop**. The
patch must quit and re-sign Claude Desktop — if you do that directly, you kill
your own session. So **never** run `node patch.mjs` yourself and **never** kill
Claude processes yourself. Use `install-auto.sh`, which detaches into its own
process so it survives Claude restarting.

## Install steps

1. Make sure you are inside the cloned repo directory. If you only have the URL:
   ```sh
   git clone https://github.com/NitzanBar1/claude-desktop-rtl-mac.git
   cd claude-desktop-rtl-mac
   ```
2. Launch the detached installer (it runs `npm install` itself if needed):
   ```sh
   bash install-auto.sh
   ```
   This returns immediately. The detached process will then: quit Claude Desktop
   → apply the patch → re-sign → relaunch Claude Desktop.
3. **Expect your session to pause** when Claude Desktop quits and **resume**
   automatically ~30–60s later when it relaunches. This is normal. Do not act
   while paused; just continue once you're back.
4. After you resume, verify:
   ```sh
   tail -n 40 /tmp/claude-rtl-install.log
   grep -q CLAUDE_RTL_PATCH_START "/Applications/Claude.app/Contents/Resources/app.asar" \
     && echo "INSTALLED" || echo "NOT INSTALLED"
   ```
   Success looks like `patch applied OK` and `[✓] done` in the log, and
   `INSTALLED` from the grep.
5. Tell the user it's installed and to try a Hebrew chat. Note that Claude
   Desktop auto-updates and each update reverts the patch — re-running
   `bash install-auto.sh` reinstalls it.

## Uninstall

Same detached mechanism (uninstall also re-signs, so Claude must restart):
```sh
bash install-auto.sh uninstall
```
Your session pauses and resumes the same way. Verify with the log and:
`grep -q CLAUDE_RTL_PATCH_START "/Applications/Claude.app/Contents/Resources/app.asar" && echo "STILL PATCHED" || echo "REMOVED"`

## What it changes (so you can answer questions)

- Injects an RTL detector into the Electron **main process** (`app.asar`), which
  runs CSS/JS on the remote claude.ai web contents.
- Updates `Info.plist` `ElectronAsarIntegrity` (macOS ASAR integrity).
- Ad-hoc re-signs the bundle (drops Anthropic notarization + the team-scoped
  WebAuthn keychain entitlement; email/SSO login unaffected).
