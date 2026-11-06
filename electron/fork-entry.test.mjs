import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  ready: null,
  mainLoaded: vi.fn(),
  writeFile: vi.fn(),
  setPath: vi.fn(),
  exit: vi.fn(),
  exists: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    getPath: name => name === "home" ? "/Users/example" : "/Users/example/Library/Application Support",
    setPath: fixture.setPath,
    whenReady: () => fixture.ready.promise,
    getVersion: () => "0.1.143",
    exit: fixture.exit,
  },
  safeStorage: { isAsyncEncryptionAvailable: vi.fn(), decryptStringAsync: vi.fn() },
}));
vi.mock("node:fs", () => ({ default: {
  existsSync: fixture.exists,
  mkdirSync: vi.fn(),
  writeFileSync: fixture.writeFile,
} }));
vi.mock("./secure-credentials.mjs", () => ({
  readSecureCredentials: async () => ({ status: "ok", credentials: {
    composioBrokerToken: "secret-token-never-written",
    composioInstallationId: "private-installation-id",
  } }),
}));
vi.mock("./main.mjs", () => { fixture.mainLoaded(); return {}; });

const originalArgv = process.argv;
const originalRoot = process.env.OMB_FORK_PROFILE_ROOT;
const originalData = process.env.OMB_DATA_DIR;
const originalResources = process.resourcesPath;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.exists.mockReturnValue(false);
  fixture.ready = Promise.withResolvers();
  process.argv = ["electron", "."];
  process.resourcesPath = "/tmp/fork-app-resources";
  process.env.OMB_FORK_PROFILE_ROOT = "/tmp/fork-test";
  process.env.OMB_DATA_DIR = "/tmp/prior-data";
});
afterEach(() => {
  process.argv = originalArgv;
  if (originalResources === undefined) delete process.resourcesPath;
  else process.resourcesPath = originalResources;
  if (originalRoot === undefined) delete process.env.OMB_FORK_PROFILE_ROOT;
  else process.env.OMB_FORK_PROFILE_ROOT = originalRoot;
  if (originalData === undefined) delete process.env.OMB_DATA_DIR;
  else process.env.OMB_DATA_DIR = originalData;
});

it("keeps normal fork launches in the separate profile", async () => {
  await import("./fork-entry.mjs");
  expect(fixture.setPath).toHaveBeenCalledWith("userData", "/tmp/fork-test/desktop");
  expect(process.env.OMB_DATA_DIR).toBe("/tmp/fork-test/workspace");
  expect(fixture.mainLoaded).toHaveBeenCalledOnce();
});

it("leaves the installed storage paths in place only with the explicit reuse flag", async () => {
  process.argv.push("--fork-use-existing-setup");
  await import("./fork-entry.mjs");
  expect(fixture.setPath).not.toHaveBeenCalled();
  expect(process.env.OMB_DATA_DIR).toBe("/tmp/prior-data");
  expect(fixture.writeFile).not.toHaveBeenCalled();
});

it("finishes loading before ready and checks credentials without starting the server or writing secrets", async () => {
  process.argv.push("--fork-check-credentials");
  await import("./fork-entry.mjs");
  expect(fixture.mainLoaded).not.toHaveBeenCalled();
  expect(fixture.exit).not.toHaveBeenCalled();
  fixture.ready.resolve();
  await vi.waitFor(() => expect(fixture.exit).toHaveBeenCalledWith(0));
  const report = JSON.parse(fixture.writeFile.mock.calls.at(-1)[1]);
  expect(report).toMatchObject({ status: "ok", savedCredentialCount: 2, managedConnectionsIdentityPresent: true });
  expect(JSON.stringify(fixture.writeFile.mock.calls)).not.toContain("secret-token-never-written");
  expect(JSON.stringify(fixture.writeFile.mock.calls)).not.toContain("private-installation-id");
});

it("supports an explicitly packaged existing-setup launcher", async () => {
  fixture.exists.mockReturnValue(true);
  await import("./fork-entry.mjs");
  expect(fixture.setPath).not.toHaveBeenCalled();
  expect(fixture.writeFile).not.toHaveBeenCalled();
  expect(process.env.OMB_DATA_DIR).toBe("/tmp/prior-data");
});

it("refuses to run a credential probe against the active installed profile", async () => {
  process.argv.push("--fork-check-credentials", "--fork-use-existing-setup");
  await expect(import("./fork-entry.mjs")).rejects.toThrow("separate profile");
  expect(fixture.mainLoaded).not.toHaveBeenCalled();
});
