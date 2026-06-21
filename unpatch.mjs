#!/usr/bin/env node
/* Claude Desktop RTL patch — uninstaller (macOS).
 *
 * Restores the pristine app.asar and Info.plist from the backups the installer
 * made, then ad-hoc re-signs so the restored bundle launches.
 *
 * Note: the original Anthropic Developer ID signature cannot be recreated. This
 * restores Claude's *behavior* to stock. For a fully notarized bundle again,
 * reinstall Claude from https://claude.ai/download .
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const APP = process.env.CLAUDE_APP || "/Applications/Claude.app";
const RES = join(APP, "Contents", "Resources");
const ASAR = join(RES, "app.asar");
const BAK = join(RES, "app.asar.rtlbak");
const META = join(RES, ".rtl-patch.json");
const INFO = join(APP, "Contents", "Info.plist");
const INFO_BAK = INFO + ".rtlbak";

const die = (m) => { console.error("✗ " + m); process.exit(1); };
const ok = (m) => console.log("✓ " + m);

if (!existsSync(BAK)) die(`No backup at ${BAK}. Nothing to restore (or already removed). To fully reset, reinstall Claude.`);

copyFileSync(BAK, ASAR);
ok("restored pristine app.asar");

if (existsSync(INFO_BAK)) {
  copyFileSync(INFO_BAK, INFO);
  ok("restored Info.plist");
  rmSync(INFO_BAK, { force: true });
}

rmSync(BAK, { force: true });
rmSync(META, { force: true });
ok("removed patch backups/metadata");

execFileSync("codesign", ["--remove-signature", APP], { stdio: "ignore" });
execFileSync("codesign", ["--force", "--sign", "-", APP]);
execFileSync("codesign", ["--verify", "--verbose=2", APP], { stdio: "inherit" });
ok("re-signed (ad-hoc) and verified");

console.log("\n✅ RTL patch removed. Fully quit Claude (⌘Q) and reopen.");
console.log("   For the original notarized build, reinstall from https://claude.ai/download");
