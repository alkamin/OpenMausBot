import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

assert.equal(process.platform, "darwin", "This fixture requires macOS");
const run = promisify(execFile);
const output = await mkdtemp(path.join(tmpdir(), "omb-mac-quit-dock-"));
const electron = createRequire(import.meta.url)("electron");
const sourceBundle = path.resolve(electron, "../../..");
const fixtureMain = `
import { app, BrowserWindow, session } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAllWindowsClosedQuit } from './window-all-closed.mjs';
const [output, mode] = process.argv.slice(process.argv.indexOf('--fixture') + 1);
const save = (name, value) => writeFileSync(path.join(output, name + '.json'), JSON.stringify(value));
app.setPath('userData', path.join(output, 'profile'));
app.setPath('sessionData', path.join(output, 'profile'));
app.setAppLogsPath(path.join(output, 'logs'));
app.commandLine.appendSwitch('disable-background-networking');
if (mode === 'accessory') createAllWindowsClosedQuit({ app, allWindows: () => BrowserWindow.getAllWindows() });
let quits = 0;
app.on('before-quit', event => {
  if (++quits !== 1) return;
  event.preventDefault();
  save('deferred', { dockVisible: app.dock.isVisible() });
  setTimeout(() => app.quit(), 500);
});
app.on('will-quit', () => save('quit', { dockVisible: app.dock.isVisible(), quits }));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !request.url.startsWith('data:') }));
  const win = new BrowserWindow({ width: 420, height: 240, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('data:text/html,<title>OpenMausBot isolated Dock fixture</title><p>Isolated Dock verification</p>');
  const child = spawn('/bin/sleep', ['120'], { detached: true, stdio: 'ignore' });
  child.unref();
  save('ready', { pid: process.pid, childPid: child.pid, dockVisible: app.dock.isVisible() });
  const poll = setInterval(() => {
    if (!existsSync(path.join(output, 'quit-request'))) return;
    clearInterval(poll);
    app.quit();
  }, 25);
}).catch(error => { save('error', { message: error.stack }); app.exit(1); });
`;

async function until(read, label) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}. Evidence: ${output}`);
}

const json = file => readFile(file, "utf8").then(JSON.parse).catch(error => {
  if (error.code === "ENOENT") return null;
  throw error;
});
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
async function entryFor(identifier) {
  const { stdout } = await run("/usr/bin/lsappinfo", ["list"]);
  return stdout.split(/(?=^\d+\) )/m).find(block => block.includes(`bundleID="${identifier}"`)) ?? null;
}

const children = new Set();
const apps = new Set();
const checks = [];
try {
  for (const mode of ["foreground", "accessory"]) {
    const directory = path.join(output, mode);
    await mkdir(directory);
    const bundle = path.join(directory, `OpenMausBot Dock ${mode}.app`);
    await run("/bin/cp", ["-cR", sourceBundle, bundle]);
    const contents = path.join(bundle, "Contents");
    const resources = path.join(contents, "Resources", "app");
    await mkdir(resources);
    const identifier = `com.openmausbot.fixture.quit-dock.${path.basename(output).split('-').at(-1).toLowerCase()}.${mode}`;
    const plist = path.join(contents, "Info.plist");
    for (const [key, value] of [["CFBundleIdentifier", identifier], ["CFBundleName", `OpenMausBot Dock ${mode}`], ["CFBundleDisplayName", `OpenMausBot Dock ${mode}`]]) {
      await run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
    }
    await writeFile(path.join(resources, "package.json"), JSON.stringify({ name: "omb-dock-fixture", version: "1.0.0", main: "main.mjs" }));
    await writeFile(path.join(resources, "main.mjs"), fixtureMain);
    await copyFile(new URL("../electron/mac-quit-dock.mjs", import.meta.url), path.join(resources, "mac-quit-dock.mjs"));
    await copyFile(new URL("../electron/window-all-closed.mjs", import.meta.url), path.join(resources, "window-all-closed.mjs"));
    await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle], { timeout: 30_000 });
    await run("/usr/bin/open", ["-n", "--env", `HOME=${directory}`, "--env", "ELECTRON_RUN_AS_NODE=", "--stdout", path.join(directory, "stdout.log"), "--stderr", path.join(directory, "stderr.log"), bundle, "--args", "--fixture", directory, mode]);
    const ready = await until(() => json(path.join(directory, "ready.json")), `${mode} app ready`);
    apps.add(ready.pid);
    children.add(ready.childPid);
    assert.equal(ready.dockVisible, true);
    const before = await entryFor(identifier);
    assert.match(before, /type="Foreground"/);
    await writeFile(path.join(directory, "quit-request"), "");
    const quit = await until(() => json(path.join(directory, "quit.json")), `${mode} app quits`);
    assert.equal((await json(path.join(directory, "deferred.json"))).dockVisible, true);
    assert.equal(quit.quits, 2);
    assert.equal(quit.dockVisible, mode === "foreground");
    await until(() => !alive(ready.pid), `${mode} app exits`);
    apps.delete(ready.pid);
    assert.equal(alive(ready.childPid), true);
    let after;
    if (mode === "foreground") {
      after = await until(async () => {
        const entry = await entryFor(identifier);
        return entry?.includes("exited-with-subordinates") ? entry : null;
      }, "baseline background Dock entry");
      assert.match(after, /type="Foreground"/);
      checks.push("unmodified quit reproduces a foreground entry retained for a surviving child");
    } else {
      await until(async () => {
        after = await entryFor(identifier);
        return !after?.includes('type="Foreground"');
      }, "fixed app has no foreground background Dock entry");
      checks.push("normal Dock while open and during deferred quit", "final quit leaves no foreground Dock entry", "independent background child survives quit");
    }
    await writeFile(path.join(directory, "evidence.json"), JSON.stringify({ ready, quit, before, after }, null, 2));
  }
  await writeFile(path.join(output, "receipt.json"), JSON.stringify({ passed: true, checks, limitation: "Launch Services application types and Electron Dock visibility verified; no physical Dock clicks, real database, workspace, server, or updater exercised." }, null, 2));
  console.log(`macOS quit/Dock verification passed. Evidence: ${output}`);
} finally {
  for (const pid of [...apps, ...children]) if (alive(pid)) process.kill(pid, "SIGTERM");
}
