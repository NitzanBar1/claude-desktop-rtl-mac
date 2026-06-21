#!/usr/bin/env node
/* Claude Desktop RTL patch — installer (macOS).
 *
 * Injects an RTL auto-detection hook into Claude Desktop's main process so that
 * Hebrew / Arabic text aligns right-to-left in the chat (which loads from
 * claude.ai into an Electron WebContentsView) and in the composer.
 *
 * FAIL-SAFE: the original app.asar, Info.plist and _CodeSignature are backed up
 * OUTSIDE the app bundle first. The destructive steps (swap asar → update
 * Info.plist integrity hash → ad-hoc re-sign) are wrapped so that if ANY step
 * fails — e.g. macOS "App Management" blocks codesign — the app is rolled back
 * to the exact original by plain file copy (no codesign needed). The app is
 * therefore never left in a broken, unlaunchable state.
 *
 * Usage:
 *   node patch.mjs            apply the patch (Claude must be quit)
 *   node patch.mjs --dry-run  build + verify in a temp dir; app untouched (safe
 *                             to run while Claude is open)
 */
import { execFileSync } from "node:child_process";
import {
  cpSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync,
  rmSync, statSync, chmodSync, existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import * as asar from "@electron/asar";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.CLAUDE_APP || "/Applications/Claude.app";
const RES = join(APP, "Contents", "Resources");
const ASAR = join(RES, "app.asar");
const UNPACKED = join(RES, "app.asar.unpacked");
const INFO = join(APP, "Contents", "Info.plist");
const CS = join(APP, "Contents", "_CodeSignature");
// codesign rewrites the main executable too, so it must be backed up/restored.
let MAIN_EXE = join(APP, "Contents", "MacOS", "Claude"); // refined from CFBundleExecutable below

// Backups live OUTSIDE the bundle so rollback can restore a pristine,
// still-notarized app (an extra file inside the bundle would break its seal).
const BACKUP_DIR = process.env.RTL_BACKUP_DIR ||
  join(homedir(), "Library", "Application Support", "claude-rtl-patch");
const B_ASAR = join(BACKUP_DIR, "app.asar.orig");
const B_INFO = join(BACKUP_DIR, "Info.plist.orig");
const B_CS = join(BACKUP_DIR, "_CodeSignature.orig");
const B_EXE = join(BACKUP_DIR, "main-exe.orig");
const B_META = join(BACKUP_DIR, "backup.json");

const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const MAIN_ENTRY = ".vite/build/index.pre.js";
const MARK_START = "/*CLAUDE_RTL_PATCH_START*/";
const MARK_END = "/*CLAUDE_RTL_PATCH_END*/";
const integrityKey = ":ElectronAsarIntegrity:Resources/app.asar:hash";

const DRY = process.argv.includes("--dry-run");
const die = (m) => { console.error("✗ " + m); process.exit(1); };
const ok = (m) => console.log("✓ " + m);

function headerHash(asarPath) {
  return crypto.createHash("sha256").update(asar.getRawHeader(asarPath).headerString).digest("hex");
}
function unpackedSet(asarPath) {
  const { header } = asar.getRawHeader(asarPath);
  const out = [];
  (function walk(node, path) {
    if (node.files) for (const k of Object.keys(node.files)) walk(node.files[k], path + "/" + k);
    else if (node.unpacked) out.push(path);
  })(header, "");
  return out.sort();
}
function plistGet(kp) { return execFileSync(PLIST_BUDDY, ["-c", `Print ${kp}`, INFO], { encoding: "utf8" }).trim(); }
function plistSet(kp, v) { execFileSync(PLIST_BUDDY, ["-c", `Set ${kp} ${v}`, INFO]); }
function isPatched(p) { return readFileSync(p).includes(Buffer.from(MARK_START)); }
function errText(e) { return (e && (e.stderr?.toString() || e.message)) || String(e); }

function makeBackup(version, originalHash) {
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  mkdirSync(BACKUP_DIR, { recursive: true });
  copyFileSync(ASAR, B_ASAR);
  copyFileSync(INFO, B_INFO);
  copyFileSync(MAIN_EXE, B_EXE);
  cpSync(CS, B_CS, { recursive: true });
  writeFileSync(B_META, JSON.stringify({ version, originalHash, mainExe: MAIN_EXE, createdAt: new Date().toISOString() }, null, 2));
}
function backupValid(version) {
  if (![B_ASAR, B_INFO, B_CS, B_EXE, B_META].every(existsSync)) return false;
  try { return JSON.parse(readFileSync(B_META, "utf8")).version === version; } catch { return false; }
}
function restoreFromBackup() {
  copyFileSync(B_ASAR, ASAR);
  copyFileSync(B_INFO, INFO);
  copyFileSync(B_EXE, MAIN_EXE);
  chmodSync(MAIN_EXE, statSync(B_EXE).mode);
  rmSync(CS, { recursive: true, force: true });
  cpSync(B_CS, CS, { recursive: true });
}

// --- preflight -------------------------------------------------------------
if (!existsSync(APP)) die(`Claude.app not found at ${APP}`);
if (!existsSync(ASAR)) die(`app.asar not found at ${ASAR}`);
if (!DRY && claudeRunning())
  die(
    "Claude Desktop is running. Quit it (⌘Q) before patching (re-signing a\n" +
    "  running app fails). Run this from the macOS Terminal — NOT a terminal\n" +
    "  inside Claude Desktop — or use install-auto.sh, which handles this.\n" +
    "  (`node patch.mjs --dry-run` tests the build safely while Claude runs.)"
  );

function claudeRunning() {
  try { execFileSync("pgrep", ["-f", join(APP, "Contents", "MacOS", "Claude")], { stdio: "ignore" }); return true; }
  catch { return false; }
}

const version = (() => { try { return plistGet(":CFBundleShortVersionString"); } catch { return "?"; } })();
try { const exe = plistGet(":CFBundleExecutable"); if (exe) MAIN_EXE = join(APP, "Contents", "MacOS", exe); } catch {}
let infoHadIntegrity = true;
try { plistGet(integrityKey); } catch { infoHadIntegrity = false; }
console.log(`Claude Desktop ${version} @ ${APP}` + (DRY ? "  (dry-run: app will NOT be modified)" : ""));

// --- establish a pristine source + backup ---------------------------------
if (isPatched(ASAR)) {
  if (DRY) die("live app.asar is already patched — nothing to dry-run. Uninstall first.");
  if (backupValid(version)) {
    restoreFromBackup();
    ok("restored pristine app.asar from backup before rebuild");
  } else {
    die("app.asar is already patched but no matching pristine backup exists.\n" +
        "  Reinstall Claude from https://claude.ai/download, then re-run.");
  }
}
const originalHash = headerHash(ASAR);
const originalUnpacked = unpackedSet(ASAR);
if (!DRY) { makeBackup(version, originalHash); ok(`backed up pristine app to ${BACKUP_DIR}`); }

// --- extract + inject + repack (in a temp dir; app untouched so far) -------
const work = mkdtempSync(join(tmpdir(), "claude-rtl-"));
const tree = join(work, "app");
asar.extractAll(ASAR, tree);
ok("extracted app.asar");

for (const rel of originalUnpacked) {
  const src = join(UNPACKED, rel), dst = join(tree, rel);
  if (!existsSync(src)) die(`expected unpacked file missing on disk: ${src}`);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  chmodSync(dst, statSync(src).mode);
}
ok(`overlaid ${originalUnpacked.length} unpacked binaries`);

const entryPath = join(tree, MAIN_ENTRY);
let entry = readFileSync(entryPath, "utf8");
if (entry.includes(MARK_START)) die("source entry already patched (unexpected)");
if (!entry.startsWith('"use strict";')) die(`main entry does not start with the expected "use strict" directive`);

const css = readFileSync(join(HERE, "rtl.css"), "utf8");
const js = readFileSync(join(HERE, "rtl.js"), "utf8");
const snippet =
  MARK_START + ";(function(){try{" +
  "var _e=require('electron'),_app=_e.app;" +
  "if(!_app||_app.__claudeRtlPatched)return;_app.__claudeRtlPatched=true;" +
  "var CSS=" + JSON.stringify(css) + ";var JS=" + JSON.stringify(js) + ";" +
  "_app.on('web-contents-created',function(_ev,wc){var cssDone=false;" +
  "function inj(){try{if(!cssDone){cssDone=true;wc.insertCSS(CSS).catch(function(){});}" +
  "wc.executeJavaScript(JS).catch(function(){});}catch(e){}}" +
  "wc.on('dom-ready',inj);wc.on('did-frame-finish-load',inj);});" +
  "}catch(e){}})();" + MARK_END;
entry = entry.replace('"use strict";', '"use strict";' + snippet);
writeFileSync(entryPath, entry);
ok("injected RTL hook into main process entry");

const newAsar = join(work, "app.asar");
await asar.createPackageWithOptions(tree, newAsar, { unpack: "{**/*.node,**/*.dylib,**/spawn-helper}" });
ok("repacked app.asar");

// --- verify the build before touching the real app ------------------------
const newUnpacked = unpackedSet(newAsar);
if (JSON.stringify(newUnpacked) !== JSON.stringify(originalUnpacked))
  die("unpacked-file set changed after repack — aborting.\n  before: " + originalUnpacked.join(", ") + "\n  after:  " + newUnpacked.join(", "));
ok(`unpacked set preserved (${newUnpacked.length} files)`);
const newEntry = asar.extractFile(newAsar, MAIN_ENTRY).toString();
if (!newEntry.includes(MARK_START) || !newEntry.startsWith('"use strict";')) die("repacked entry failed verification");
const newHash = headerHash(newAsar);
ok(`new header hash ${newHash.slice(0, 16)}…`);

if (DRY) {
  rmSync(work, { recursive: true, force: true });
  console.log("\n✅ Dry-run passed: extract → inject → repack → verify all OK. App NOT modified.");
  console.log("   To apply: quit Claude (from Terminal, not inside Claude Desktop) and run `node patch.mjs`.");
  process.exit(0);
}

// --- destructive phase (atomic: full rollback on ANY failure) -------------
let touched = false;
try {
  copyFileSync(newAsar, ASAR); touched = true;
  ok("installed patched app.asar");

  if (infoHadIntegrity) {
    plistSet(integrityKey, newHash);
    if (plistGet(integrityKey) !== newHash) throw new Error("Info.plist integrity hash did not persist");
    ok("updated Info.plist ElectronAsarIntegrity hash");
  }

  // ad-hoc re-sign the top bundle only (helpers keep their Anthropic signatures)
  execFileSync("codesign", ["--force", "--sign", "-", APP], { stdio: "pipe" });
  execFileSync("codesign", ["--verify", "--strict", APP], { stdio: "pipe" });
  ok("re-signed (ad-hoc) and verified");
} catch (e) {
  console.error("✗ patch step failed: " + errText(e));
  if (touched) {
    try {
      restoreFromBackup();
      execFileSync("codesign", ["--verify", APP], { stdio: "ignore" });
      console.error("↩︎  rolled back — original notarized Claude restored and verified. App is safe.");
    } catch (re) {
      console.error("‼️  ROLLBACK FAILED: " + errText(re) +
        "\n   Recover by reinstalling Claude from https://claude.ai/download");
    }
  }
  die("Aborted without leaving the app broken.\n" +
      "  If macOS blocked code-signing (App Management), enable it for your terminal:\n" +
      "  System Settings → Privacy & Security → App Management → turn ON for Terminal,\n" +
      "  then fully quit & reopen Terminal and re-run. (Claude Code's install-auto.sh\n" +
      "  usually has this access already.)");
}

rmSync(work, { recursive: true, force: true });
console.log("\n✅ RTL patch installed. Fully quit Claude (⌘Q) and reopen.");
console.log("   Remove with: node unpatch.mjs");
