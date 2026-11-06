import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { forkProfilePaths } from "./fork-profile.mjs";
import { readSecureCredentials } from "./secure-credentials.mjs";

const checkCredentials = process.argv.includes("--fork-check-credentials");
const useExistingSetup = process.argv.includes("--fork-use-existing-setup") ||
  (!checkCredentials && fs.existsSync(path.join(process.resourcesPath, "fork-use-existing-setup")));
if (checkCredentials && useExistingSetup) throw new Error("Check credentials in a separate profile");

const paths = useExistingSetup ? null : forkProfilePaths(
  process.env.OMB_FORK_PROFILE_ROOT || path.join(app.getPath("appData"), "openmausbot-fork"),
  app.getPath("home"),
);
if (paths) {
  for (const directory of [paths.root, paths.desktop, paths.workspace, paths.logs, paths.crashes]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  app.setPath("userData", paths.desktop);
  app.setPath("sessionData", paths.desktop);
  app.setPath("logs", paths.logs);
  app.setPath("crashDumps", paths.crashes);
  process.env.OMB_DATA_DIR = paths.workspace;
}

if (checkCredentials && paths) {
  fs.writeFileSync(paths.credentialReport, `${JSON.stringify({ status: "starting", pid: process.pid })}\n`, { mode: 0o600 });
  void app.whenReady().then(async () => {
    const file = path.join(paths.desktop, "credentials.bin");
    const result = await readSecureCredentials({
      exists: () => fs.existsSync(file),
      isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      readFile: () => fs.readFileSync(file),
      decrypt: buffer => safeStorage.decryptStringAsync(buffer),
      sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    });
    const report = {
      pid: process.pid,
      version: app.getVersion(),
      status: result.status,
      savedCredentialCount: Object.keys(result.credentials).length,
      managedConnectionsIdentityPresent: Boolean(result.credentials.composioBrokerToken && result.credentials.composioInstallationId),
      selfHostedComposioKeyPresent: Boolean(result.credentials.composioApiKey),
    };
    fs.writeFileSync(paths.credentialReport, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    app.exit(result.status === "ok" ? 0 : 1);
  }).catch(() => app.exit(1));
} else {
  await import("./main.mjs");
}
