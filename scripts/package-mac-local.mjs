import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Arch, build, Platform } from "electron-builder";
import { LOCAL_APP_ID, setupLocalSigningIdentity, signLocalApp } from "./mac-local-signing.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { setup: { type: "boolean" } } });
if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) throw new Error("This command builds a local app on an Apple silicon or Intel Mac.");
const identity = await setupLocalSigningIdentity();
console.log(`Local signing certificate: ${identity.fingerprint}`);

if (!values.setup) {
  const env = { ...process.env, OPENMAUSBOT_CUA_ARCHES: process.arch, OPENMAUSBOT_CUA_ARCHES_PARTIAL: "1" };
  for (const script of ["package:prepare", "build:speech", "build:cua"]) {
    await new Promise((resolve, reject) => {
      const child = spawn("pnpm", [script], { cwd: root, env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${script} failed (${code}).`)));
    });
  }
  await build({
    projectDir: root, targets: Platform.MAC.createTarget(["dir"], Arch[process.arch]), publish: "never",
    config: { extends: path.join(root, "electron-builder.yml"), appId: LOCAL_APP_ID, directories: { output: "release/local" }, publish: null, mac: { identity: null } },
  });
  const app = path.join(root, "release", "local", process.arch === "arm64" ? "mac-arm64" : "mac", "OpenMausBot.app");
  const profileMarker = path.join("Contents", "Resources", "fork-use-existing-setup");
  if (existsSync(path.join("/Applications/OpenMausBot.app", profileMarker))) {
    await writeFile(path.join(app, profileMarker), "", { mode: 0o644 });
  }
  const signatures = await signLocalApp(app, identity, path.join(root, "build", "entitlements.mac.plist"));
  console.log(JSON.stringify({ app, certificate: identity.fingerprint, signatures }, null, 2));
  console.log("Install this app at /Applications/OpenMausBot.app each time. The first switch to this certificate needs fresh macOS privacy approvals.");
}
