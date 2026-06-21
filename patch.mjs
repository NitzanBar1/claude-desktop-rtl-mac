#!/usr/bin/env node
/* Claude Desktop RTL patch — installer (macOS).
 *
 * Injects an RTL auto-detection hook into Claude Desktop's main process so that
 * Hebrew / Arabic text aligns right-to-left in the chat (which loads from
 * claude.ai into an Electron WebContentsView) and in the composer.
 *
 * Steps: back up -> extract app.asar -> inject -> repack (same unpacked set)
 *        -> update Info.plist ASAR integrity hash -> ad-hoc re-sign.
 *
 * Re-running is safe: it always rebuilds from the pristine backup.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync,
  rmSync, statSync, chmodSync, existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import * as asar from "@electron/asar";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.CLAUDE_APP || "/Applications/Claude.app";
const RES = join(APP, "Contents", "Resources");
const ASAR = join(RES, "app.asar");
const UNPACKED = join(RES, "app.asar.unpacked");
const INFO = join(APP, "Contents", "Info.plist");
const BAK = join(RES, "app.asar.rtlbak");
const META = join(RES, ".rtl-patch.json");
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const MAIN_ENTRY = ".vite/build/index.pre.js";
const MARK_START = "/*CLAUDE_RTL_PATCH_START*/";
const MARK_END = "/*CLAUDE_RTL_PATCH_END*/";

// --dry-run: build + verify a patched asar in a temp dir and stop, without
// touching the installed app, changing Info.plist, or re-signing. Safe to run
// while Claude is open.
const DRY = process.argv.includes("--dry-run");

const die = (m) => { console.error("✗ " + m); process.exit(1); };
const ok = (m) => console.log("✓ " + m);

function claudeIsRunning() {
  try {
    execFileSync("pgrep", ["-f", join(APP, "Contents", "MacOS", "Claude")], { stdio: "ignore" });
    return true; // pgrep exits 0 when a match exists
  } catch {
    return false;
  }
}

function headerHash(asarPath) {
  const { headerString } = asar.getRawHeader(asarPath);
  return crypto.createHash("sha256").update(headerString).digest("hex");
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

function plistGet(keypath) {
  return execFileSync(PLIST_BUDDY, ["-c", `Print ${keypath}`, INFO], { encoding: "utf8" }).trim();
}
function plistSet(keypath, value) {
  execFileSync(PLIST_BUDDY, ["-c", `Set ${keypath} ${value}`, INFO]);
}

// --- preflight -------------------------------------------------------------
if (!existsSync(APP)) die(`Claude.app not found at ${APP}`);
if (!existsSync(ASAR)) die(`app.asar not found at ${ASAR}`);
if (!DRY && claudeIsRunning())
  die(
    "Claude Desktop is running. Fully quit it (⌘Q) before patching, because\n" +
    "  re-signing a running app fails.\n" +
    "  IMPORTANT: run this from the macOS Terminal app — NOT from a terminal\n" +
    "  inside Claude Desktop (quitting Claude would kill that session).\n" +
    "  (Use `node patch.mjs --dry-run` to test the build safely while Claude runs.)"
  );
try { writeFileSync(join(RES, ".rtlwtest"), "x"); rmSync(join(RES, ".rtlwtest")); }
catch { die(`No write permission to ${RES} (try: sudo, or fix ownership)`); }

const version = (() => {
  try { return plistGet(":CFBundleShortVersionString"); } catch { return "?"; }
})();
const integrityKey = ":ElectronAsarIntegrity:Resources/app.asar:hash";
let infoHadIntegrity = true;
try { plistGet(integrityKey); } catch { infoHadIntegrity = false; }

console.log(`Claude Desktop ${version} @ ${APP}`);

console.log(DRY ? "(dry-run: the installed app will NOT be modified)" : "");

// --- backup (only from a pristine asar) -----------------------------------
const alreadyPatched = readFileSync(ASAR).includes(Buffer.from(MARK_START));
if (alreadyPatched && !existsSync(BAK))
  die("app.asar already contains a patch but no backup exists — reinstall Claude to get a clean copy, then re-run.");

if (!DRY) {
  if (!existsSync(BAK)) {
    copyFileSync(ASAR, BAK);
    ok(`backed up pristine app.asar -> ${BAK}`);
  } else {
    ok("using existing pristine backup");
  }
  // extractAll reads unpacked files from "<asar>.unpacked", which only exists
  // for the live app.asar — so we build from the live file. If it is already
  // patched, restore the pristine backup over it first.
  if (readFileSync(ASAR).includes(Buffer.from(MARK_START))) {
    copyFileSync(BAK, ASAR);
    ok("restored pristine app.asar from backup before rebuild");
  }
}
if (alreadyPatched && DRY) die("live app.asar is already patched — dry-run needs a pristine asar to build from");
const originalHash = headerHash(ASAR);
const originalUnpacked = unpackedSet(ASAR);

// --- extract pristine asar -------------------------------------------------
const work = mkdtempSync(join(tmpdir(), "claude-rtl-"));
const tree = join(work, "app");
asar.extractAll(ASAR, tree);
ok("extracted app.asar");

// overlay the unpacked native binaries so the repack records them identically
for (const rel of originalUnpacked) {
  const src = join(UNPACKED, rel);
  const dst = join(tree, rel);
  if (!existsSync(src)) die(`expected unpacked file missing on disk: ${src}`);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  chmodSync(dst, statSync(src).mode);
}
ok(`overlaid ${originalUnpacked.length} unpacked binaries`);

// --- inject ----------------------------------------------------------------
const entryPath = join(tree, MAIN_ENTRY);
let entry = readFileSync(entryPath, "utf8");
if (entry.includes(MARK_START)) die("pristine backup is already patched (unexpected)");
if (!entry.startsWith('"use strict";'))
  die(`main entry does not start with the expected "use strict" directive`);

const css = readFileSync(join(HERE, "rtl.css"), "utf8");
const js = readFileSync(join(HERE, "rtl.js"), "utf8");
const snippet =
  MARK_START +
  ";(function(){try{" +
  "var _e=require('electron'),_app=_e.app;" +
  "if(!_app||_app.__claudeRtlPatched)return;_app.__claudeRtlPatched=true;" +
  "var CSS=" + JSON.stringify(css) + ";" +
  "var JS=" + JSON.stringify(js) + ";" +
  "_app.on('web-contents-created',function(_ev,wc){" +
  "var cssDone=false;" +
  "function inj(){try{" +
  "if(!cssDone){cssDone=true;wc.insertCSS(CSS).catch(function(){});}" +
  "wc.executeJavaScript(JS).catch(function(){});" +
  "}catch(e){}}" +
  "wc.on('dom-ready',inj);wc.on('did-frame-finish-load',inj);" +
  "});" +
  "}catch(e){}})();" +
  MARK_END;

entry = entry.replace('"use strict";', '"use strict";' + snippet);
writeFileSync(entryPath, entry);
ok("injected RTL hook into main process entry");

// --- repack ----------------------------------------------------------------
const newAsar = join(work, "app.asar");
await asar.createPackageWithOptions(tree, newAsar, {
  unpack: "{**/*.node,**/*.dylib,**/spawn-helper}",
});
ok("repacked app.asar");

// --- verify before touching the real app ----------------------------------
const newUnpacked = unpackedSet(newAsar);
if (JSON.stringify(newUnpacked) !== JSON.stringify(originalUnpacked))
  die(
    "unpacked-file set changed after repack — aborting.\n  before: " +
      originalUnpacked.join(", ") +
      "\n  after:  " +
      newUnpacked.join(", ")
  );
ok(`unpacked set preserved (${newUnpacked.length} files)`);

const newEntry = asar.extractFile(newAsar, MAIN_ENTRY).toString();
if (!newEntry.includes(MARK_START) || !newEntry.startsWith('"use strict";'))
  die("repacked entry failed marker/strict verification");
const newHash = headerHash(newAsar);
ok(`new header hash ${newHash.slice(0, 16)}…`);

if (DRY) {
  rmSync(work, { recursive: true, force: true });
  console.log("\n✅ Dry-run passed: extract → inject → repack → verify all OK.");
  console.log("   The installed app was NOT modified.");
  console.log("   To apply for real: quit Claude (from the macOS Terminal, not");
  console.log("   inside Claude Desktop) and run `node patch.mjs`.");
  process.exit(0);
}

// --- swap in (only app.asar; keep existing app.asar.unpacked) --------------
copyFileSync(newAsar, ASAR);
ok("installed patched app.asar");

// --- Info.plist integrity --------------------------------------------------
if (infoHadIntegrity) {
  copyFileSync(INFO, INFO + ".rtlbak");
  plistSet(integrityKey, newHash);
  const check = plistGet(integrityKey);
  if (check !== newHash) die("Info.plist hash write did not stick");
  ok("updated Info.plist ElectronAsarIntegrity hash");
} else {
  ok("no ElectronAsarIntegrity in Info.plist — skipping (not enforced)");
}

// --- metadata for uninstall ------------------------------------------------
writeFileSync(
  META,
  JSON.stringify({ version, originalHash, patchedHash: newHash, integrityKey, patchedAt: new Date().toISOString() }, null, 2)
);

// --- ad-hoc re-sign (top bundle only; helpers keep Anthropic signatures) ---
execFileSync("codesign", ["--remove-signature", APP], { stdio: "ignore" });
execFileSync("codesign", ["--force", "--sign", "-", APP]);
execFileSync("codesign", ["--verify", "--verbose=2", APP], { stdio: "inherit" });
ok("re-signed (ad-hoc) and verified");

rmSync(work, { recursive: true, force: true });
console.log("\n✅ RTL patch installed. Fully quit Claude (⌘Q) and reopen.");
console.log("   To remove:  node unpatch.mjs");
