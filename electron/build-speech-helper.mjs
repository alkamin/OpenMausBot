// A real app bundle: macOS TCC reads the executable's bundle Info.plist and kills a loose binary that lacks one.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(electronDir);
const resourcesDir = path.join(electronDir, "resources");

export const speechHelperBundle = path.join(resourcesDir, "OpenMausBot Speech.app");
export const speechHelperBinary = path.join(speechHelperBundle, "Contents", "MacOS", "speech-helper");

export function buildSpeechHelper(arches = ["arm64", "x64"]) {
  const contents = path.join(speechHelperBundle, "Contents");
  mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  copyFileSync(path.join(resourcesDir, "speech-helper-Info.plist"), path.join(contents, "Info.plist"));
  const targets = arches.map((arch) => {
    const target = { arm64: "arm64", x64: "x86_64" }[arch];
    if (!target) throw new Error(`Unsupported speech helper architecture: ${arch}`);
    return target;
  });
  const slices = targets.map((arch) => {
    const slice = `${speechHelperBinary}-${arch}`;
    execFileSync(
      "swiftc",
      ["-O", "-target", `${arch}-apple-macos12`, path.join(resourcesDir, "speech-helper.swift"), "-o", slice],
      { stdio: "inherit", timeout: 120_000 },
    );
    return slice;
  });
  execFileSync("lipo", ["-create", ...slices, "-output", speechHelperBinary], {
    stdio: "inherit",
    timeout: 60_000,
  });
  for (const slice of slices) rmSync(slice, { force: true });
  const archs = execFileSync("lipo", ["-archs", speechHelperBinary], { timeout: 60_000 }).toString();
  if (targets.some((arch) => !archs.trim().split(/\s+/).includes(arch))) {
    throw new Error(`speech helper is missing a requested architecture: ${archs.trim()}`);
  }
  // Ad-hoc signed for dev with the release's audio entitlement; electron-builder replaces it when signing.
  execFileSync(
    "codesign",
    [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--options",
      "runtime",
      "--entitlements",
      path.join(projectDir, "build", "entitlements.mac.plist"),
      speechHelperBundle,
    ],
    { stdio: "inherit", timeout: 30_000 },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { resolveCuaMacArches } = await import("../scripts/cua-mac-arches.mjs");
  buildSpeechHelper(resolveCuaMacArches());
}
