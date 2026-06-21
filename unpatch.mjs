#!/usr/bin/env node
/* Claude Desktop RTL patch — uninstaller (macOS).
 *
 * Restores the original app.asar, Info.plist and _CodeSignature from the backup
 * the installer made OUTSIDE the bundle. This is a pure file copy, so it brings
 * back the original *notarized* Anthropic signature and needs no codesign — it
 * works even if macOS would block re-signing.
 */
import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, chmodSync, statSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const APP = process.env.CLAUDE_APP || "/Applications/Claude.app";
const ASAR = join(APP, "Contents", "Resources", "app.asar");
const INFO = join(APP, "Contents", "Info.plist");
const CS = join(APP, "Contents", "_CodeSignature");
const BACKUP_DIR = process.env.RTL_BACKUP_DIR ||
  join(homedir(), "Library", "Application Support", "claude-rtl-patch");
const B_ASAR = join(BACKUP_DIR, "app.asar.orig");
const B_INFO = join(BACKUP_DIR, "Info.plist.orig");
const B_CS = join(BACKUP_DIR, "_CodeSignature.orig");
const B_EXE = join(BACKUP_DIR, "main-exe.orig");
const MAIN_EXE = (() => {
  try { return join(APP, "Contents", "MacOS", JSON.parse(readFileSync(join(BACKUP_DIR, "backup.json"), "utf8")).mainExe.split("/").pop()); }
  catch { return join(APP, "Contents", "MacOS", "Claude"); }
})();

const die = (m) => { console.error("✗ " + m); process.exit(1); };
const ok = (m) => console.log("✓ " + m);

function claudeRunning() {
  try { execFileSync("pgrep", ["-f", join(APP, "Contents", "MacOS", "Claude")], { stdio: "ignore" }); return true; }
  catch { return false; }
}

if (![B_ASAR, B_INFO, B_CS, B_EXE].every(existsSync))
  die(`No (complete) backup found in ${BACKUP_DIR}.\n  If the app is patched, reinstall Claude from https://claude.ai/download.`);
if (claudeRunning())
  die("Claude Desktop is running. Quit it (⌘Q) first (or use `bash install-auto.sh uninstall`).");

try {
  copyFileSync(B_ASAR, ASAR);
  copyFileSync(B_INFO, INFO);
  copyFileSync(B_EXE, MAIN_EXE);
  chmodSync(MAIN_EXE, statSync(B_EXE).mode);
  rmSync(CS, { recursive: true, force: true });
  cpSync(B_CS, CS, { recursive: true });
  ok("restored original app.asar, Info.plist, main executable and signature");
} catch (e) {
  die("restore failed: " + ((e && (e.stderr?.toString() || e.message)) || e) +
      "\n  Reinstall Claude from https://claude.ai/download if it won't launch.");
}

try {
  execFileSync("codesign", ["--verify", "--strict", APP], { stdio: "ignore" });
  ok("verified restored signature (original notarized build)");
} catch {
  console.error("⚠️  signature verify failed after restore — if Claude won't open, reinstall from https://claude.ai/download");
}

// best-effort: drop the now-unneeded backup
rmSync(BACKUP_DIR, { recursive: true, force: true });
console.log("\n✅ RTL patch removed. Fully quit Claude (⌘Q) and reopen.");
