import { describe, expect, it } from "vitest";
import path from "node:path";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { localCodeIdentifier, LOCAL_APP_ID } from "./mac-local-signing.mjs";

describe("local code identities", () => {
  it("loads the packaged speech module without build scripts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "omb-packaged-speech-"));
    try {
      const target = path.join(directory, "build-speech-helper.mjs");
      await copyFile(new URL("../electron/build-speech-helper.mjs", import.meta.url), target);
      const imported = await import(pathToFileURL(target).href);
      expect(typeof imported.buildSpeechHelper).toBe("function");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps helper identities across build output directories", () => {
    const relative = path.join("Contents", "Resources", "cua-driver");
    const first = path.resolve("first", "OpenMausBot.app");
    const second = path.resolve("second", "OpenMausBot.app");
    expect(localCodeIdentifier(path.join(first, relative), first)).toBe(localCodeIdentifier(path.join(second, relative), second));
    expect(localCodeIdentifier(path.join(first, relative), first)).toMatch(new RegExp(`^${LOCAL_APP_ID}\\.code\\.[a-f0-9]{24}$`));
    expect(localCodeIdentifier(path.join(first, "Contents", "Resources", "cloudflared"), first)).not.toBe(localCodeIdentifier(path.join(first, relative), first));
  });

  it("preserves bundle identifiers from their Info.plist", () => {
    const app = path.resolve("OpenMausBot.app");
    expect(localCodeIdentifier(app, app)).toBeUndefined();
    expect(localCodeIdentifier(path.join(app, "Contents", "Resources", "OpenMausBot Speech.app"), app)).toBeUndefined();
    expect(localCodeIdentifier(path.join(app, "Contents", "Frameworks", "Electron Framework.framework"), app)).toBeUndefined();
  });

  it("refuses to sign a binary outside the selected bundle", () => {
    const app = path.resolve("OpenMausBot.app");
    expect(() => localCodeIdentifier(path.resolve("unrelated"), app)).toThrow("outside the app");
    expect(() => localCodeIdentifier(path.resolve("unrelated.app"), app)).toThrow("outside the app");
    expect(() => localCodeIdentifier(path.dirname(app), app)).toThrow("outside the app");
  });
});
