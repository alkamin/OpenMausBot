import fs from "node:fs";
import path from "node:path";

const settings = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "fork-check.json"), "utf8"));
process.env.OMB_FORK_PROFILE_ROOT = settings.profileRoot;
process.argv.push("--fork-check-credentials");
await import("./fork-entry.mjs");
