import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { LOCAL_APP_ID, loadLocalSigningIdentity, setupLocalSigningIdentity, signLocalApp } from "./mac-local-signing.mjs";

const run = promisify(execFile);
const entitlements = fileURLToPath(new URL("../build/entitlements.mac.plist", import.meta.url));
const plist = (identifier, executable) => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>${executable}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`;

(process.platform === "darwin" && process.env.OMB_MAC_SIGN_E2E === "1" ? it : it.skip)("retains certificate-based requirements across changed app and helper binaries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "omb-local-signing-"));
  const signing = path.join(directory, "signing");
  const app = path.join(directory, "OpenMausBot.app");
  const resources = path.join(app, "Contents", "Resources");
  const speech = path.join(resources, "OpenMausBot Speech.app");
  try {
    const identity = await setupLocalSigningIdentity(signing);
    expect((await stat(signing)).mode & 0o077).toBe(0);
    expect((await stat(path.join(signing, "keychain-password"))).mode & 0o077).toBe(0);
    const saved = await readFile(path.join(signing, "identity.json"), "utf8");
    expect(await setupLocalSigningIdentity(signing)).toEqual(identity);
    expect(await readFile(path.join(signing, "identity.json"), "utf8")).toBe(saved);
    await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
    await mkdir(path.join(speech, "Contents", "MacOS"), { recursive: true });
    await writeFile(path.join(app, "Contents", "Info.plist"), plist(LOCAL_APP_ID, "OpenMausBot"));
    await writeFile(path.join(speech, "Contents", "Info.plist"), plist(`${LOCAL_APP_ID}.speech`, "speech-helper"));
    const targets = [path.join(app, "Contents", "MacOS", "OpenMausBot"), path.join(speech, "Contents", "MacOS", "speech-helper"), path.join(resources, "cua-driver")];
    const rounds = [];
    for (const value of [0, 1]) {
      const source = path.join(directory, "fixture.c");
      await writeFile(source, `int main(void) { return ${value}; }\n`);
      for (const target of targets) await run("/usr/bin/clang", [source, "-o", target]);
      const signatures = await signLocalApp(app, identity, entitlements);
      const hashes = await Promise.all(targets.map(async target => {
        const result = await run("/usr/bin/codesign", ["--display", "--verbose=4", target]);
        return result.stderr.match(/^CDHash=(.+)$/m)?.[1];
      }));
      expect(hashes.every(Boolean)).toBe(true);
      rounds.push({ signatures, hashes });
    }
    expect(rounds[0].hashes).not.toEqual(rounds[1].hashes);
    expect(rounds[0].signatures).toEqual(rounds[1].signatures);
    await rm(path.join(signing, "identity.json"));
    await expect(setupLocalSigningIdentity(signing)).rejects.toThrow();
    await expect(loadLocalSigningIdentity(signing)).rejects.toThrow();
  } finally {
    await run("/usr/bin/security", ["delete-keychain", path.join(signing, "signing.keychain-db")]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
