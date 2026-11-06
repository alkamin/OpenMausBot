import path from "node:path";

export function forkProfilePaths(root, home) {
  if (!root || !path.isAbsolute(root)) throw new Error("The fork profile must use an absolute path");
  const resolved = path.resolve(root);
  const original = [
    path.join(home, ".openmausbot"),
    path.join(home, "Library", "Application Support", "openmausbot"),
  ];
  for (const protectedPath of original) {
    if (resolved === protectedPath || resolved.startsWith(`${protectedPath}${path.sep}`)) {
      throw new Error("Use a separate profile for the fork");
    }
  }
  return {
    root: resolved,
    desktop: path.join(resolved, "desktop"),
    workspace: path.join(resolved, "workspace"),
    logs: path.join(resolved, "logs"),
    crashes: path.join(resolved, "crashes"),
    credentialReport: path.join(resolved, "credential-check.json"),
  };
}
