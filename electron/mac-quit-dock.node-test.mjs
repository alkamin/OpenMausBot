import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { installMacQuitDock } from "./mac-quit-dock.mjs";

test("keeps the Mac app in the Dock throughout deferred shutdown", () => {
  const app = new EventEmitter();
  const policies = [];
  app.setActivationPolicy = policy => policies.push(policy);
  installMacQuitDock({ app, platform: "darwin" });
  app.emit("before-quit", { preventDefault() {} });
  assert.deepEqual(policies, []);
  app.emit("will-quit");
  assert.deepEqual(policies, ["accessory"]);
});

for (const platform of ["win32", "linux"]) {
  test(`preserves ${platform} shutdown`, () => {
    const app = new EventEmitter();
    app.setActivationPolicy = () => assert.fail("macOS API called on another platform");
    installMacQuitDock({ app, platform });
    assert.equal(app.listenerCount("will-quit"), 0);
    app.emit("will-quit");
  });
}
