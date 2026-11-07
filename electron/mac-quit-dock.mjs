export function installMacQuitDock({ app, platform = process.platform }) {
  if (platform !== "darwin") return;
  // macOS 27 retains a foreground app's Dock entry after exit while its subprocesses survive.
  app.on("will-quit", () => app.setActivationPolicy("accessory"));
}
