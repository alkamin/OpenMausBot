import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { signAsync } from "@electron/osx-sign";

const execute = promisify(execFile);
const CERTIFICATE_NAME = "OpenMausBot Local Development";
export const LOCAL_APP_ID = "com.alkamin.openmausbot";

async function run(file, args) {
  try {
    return await execute(file, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${path.basename(file)} failed (${error.code ?? "unknown"}). ${error.stderr?.trim() ?? ""}`);
  }
}

export function localSigningDirectory() {
  return path.join(homedir(), "Library", "Application Support", "OpenMausBot", "Local Signing");
}

function signingPaths(directory) {
  return {
    keychain: path.join(directory, "signing.keychain-db"),
    password: path.join(directory, "keychain-password"),
    certificate: path.join(directory, "certificate.pem"),
    identity: path.join(directory, "identity.json"),
  };
}

async function fingerprint(certificate) {
  const { stdout } = await run("/usr/bin/openssl", ["x509", "-in", certificate, "-noout", "-fingerprint", "-sha1"]);
  const hash = stdout.trim().split("=").at(-1).replaceAll(":", "");
  if (!/^[A-F0-9]{40}$/i.test(hash)) throw new Error("Cannot read the local signing certificate fingerprint.");
  return hash.toUpperCase();
}

export async function loadLocalSigningIdentity(directory = localSigningDirectory()) {
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) {
    throw new Error("The local signing directory must be a real, owner-only directory.");
  }
  const files = signingPaths(directory);
  for (const file of Object.values(files)) {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Expected a regular signing file: ${file}`);
    if ([files.keychain, files.password].includes(file) && (details.mode & 0o077) !== 0) throw new Error(`Signing credentials must be owner-only: ${file}`);
  }
  const identity = JSON.parse(await readFile(files.identity, "utf8"));
  if (identity.schemaVersion !== 1 || !/^[A-F0-9]{40}$/.test(identity.fingerprint)) {
    throw new Error("Invalid local signing identity; keep the existing certificate to preserve macOS permissions.");
  }
  if (await fingerprint(files.certificate) !== identity.fingerprint) throw new Error("The local signing certificate has changed.");
  const password = (await readFile(files.password, "utf8")).trim();
  await run("/usr/bin/security", ["unlock-keychain", "-p", password, files.keychain]);
  const { stdout } = await run("/usr/bin/security", ["find-identity", "-p", "codesigning", files.keychain]);
  if (!stdout.includes(identity.fingerprint)) throw new Error("The persistent local signing key is missing from its keychain.");
  return { keychain: files.keychain, fingerprint: identity.fingerprint, certificate: files.certificate };
}

export async function setupLocalSigningIdentity(directory = localSigningDirectory()) {
  if (process.platform !== "darwin") throw new Error("Local macOS signing requires macOS.");
  try {
    await lstat(directory);
    return await loadLocalSigningIdentity(directory);
  } catch (error) {
    if (error.code !== "ENOENT" || error.path !== directory) throw error;
  }
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  const files = signingPaths(directory);
  const temporary = await mkdtemp(path.join(tmpdir(), "omb-local-certificate-"));
  try {
    const key = path.join(temporary, "private-key.pem");
    const archive = path.join(temporary, "identity.p12");
    const config = path.join(temporary, "openssl.cnf");
    await writeFile(config, [
      "[req]", "prompt=no", "distinguished_name=name", "x509_extensions=extensions",
      "[name]", `CN=${CERTIFICATE_NAME}`,
      "[extensions]", "basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature",
      "extendedKeyUsage=critical,codeSigning", "subjectKeyIdentifier=hash", "",
    ].join("\n"), { mode: 0o600 });
    await run("/usr/bin/openssl", ["req", "-new", "-x509", "-newkey", "rsa:3072", "-nodes", "-sha256", "-days", "3650", "-config", config, "-keyout", key, "-out", files.certificate]);
    await chmod(key, 0o600);
    const password = randomBytes(32).toString("hex");
    await writeFile(files.password, password, { mode: 0o600, flag: "wx" });
    await run("/usr/bin/openssl", ["pkcs12", "-export", "-inkey", key, "-in", files.certificate, "-name", CERTIFICATE_NAME, "-out", archive, "-passout", `pass:${password}`]);
    await run("/usr/bin/security", ["create-keychain", "-p", password, files.keychain]);
    await run("/usr/bin/security", ["set-keychain-settings", "-lut", "21600", files.keychain]);
    await run("/usr/bin/security", ["unlock-keychain", "-p", password, files.keychain]);
    await run("/usr/bin/security", ["import", archive, "-k", files.keychain, "-P", password, "-T", "/usr/bin/codesign"]);
    await run("/usr/bin/security", ["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, files.keychain]);
    await chmod(files.keychain, 0o600);
    await writeFile(files.identity, JSON.stringify({ schemaVersion: 1, fingerprint: await fingerprint(files.certificate) }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    return await loadLocalSigningIdentity(directory);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function localCodeIdentifier(file, app) {
  const relative = path.relative(app, file).split(path.sep).join("/");
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("Signing target is outside the app.");
  if (file === app || /\.(?:app|framework)$/.test(file)) return undefined;
  return `${LOCAL_APP_ID}.code.${createHash("sha256").update(relative).digest("hex").slice(0, 24)}`;
}

export async function signLocalApp(app, identity, entitlements) {
  const { stdout } = await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(app, "Contents", "Info.plist")]);
  if (stdout.trim() !== LOCAL_APP_ID) throw new Error(`Local app must keep bundle ID ${LOCAL_APP_ID}.`);
  await signAsync({
    app, platform: "darwin", identity: identity.fingerprint, keychain: identity.keychain,
    identityValidation: false, preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    optionsForFile(file) {
      const identifier = localCodeIdentifier(file, app);
      return { entitlements, hardenedRuntime: true, timestamp: "none", additionalArguments: identifier ? ["--identifier", identifier] : [] };
    },
  });
  const targets = [app, path.join(app, "Contents", "Resources", "OpenMausBot Speech.app"), path.join(app, "Contents", "Resources", "cua-driver")];
  const signatures = [];
  for (const target of targets) {
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", target]);
    await run("/usr/bin/codesign", ["--verify", "-R", `=certificate leaf = H"${identity.fingerprint}"`, target]);
    const { stdout, stderr } = await run("/usr/bin/codesign", ["--display", "--requirements", "-", target]);
    const requirements = `${stdout}\n${stderr}`.trim();
    if (!requirements.includes("designated =>") || /cdhash|Signature=adhoc/.test(requirements)) throw new Error(`Unstable local signature: ${target}`);
    signatures.push({ target, requirements });
  }
  return signatures;
}
