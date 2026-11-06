import assert from "node:assert/strict";
import test from "node:test";
import { forkProfilePaths } from "./fork-profile.mjs";

test("fork files stay in the selected profile rather than the installed workspace", () => {
  const paths = forkProfilePaths("/tmp/omb-fork", "/Users/example");
  assert.equal(paths.desktop, "/tmp/omb-fork/desktop");
  assert.equal(paths.workspace, "/tmp/omb-fork/workspace");
  assert.equal(paths.credentialReport, "/tmp/omb-fork/credential-check.json");
});

test("the fork refuses the original workspace and desktop profile", () => {
  for (const root of [
    "/Users/example/.openmausbot",
    "/Users/example/.openmausbot/test",
    "/Users/example/Library/Application Support/openmausbot",
    "/Users/example/Library/Application Support/openmausbot/test",
    "/tmp/../Users/example/.openmausbot",
  ]) {
    assert.throws(() => forkProfilePaths(root, "/Users/example"), /separate profile/);
  }
  assert.throws(() => forkProfilePaths("relative", "/Users/example"), /absolute path/);
});
