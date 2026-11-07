# macOS Dock entry after quit

```sh
node --test electron/mac-quit-dock.node-test.mjs electron/single-instance.node-test.mjs electron/startup-tray.node-test.mjs
node scripts/verify-mac-quit-dock.mjs
```

The macOS fixture copies the development Electron runtime into two uniquely
identified, ad-hoc signed test apps under a temporary directory. Each gets its
own home and profile, blocks network access, opens a synthetic page, and launches
an inert `sleep` child. It does not open the installed app, a workspace, the
server, computer control, or a real database.

The unmodified app reproduces a foreground Launch Services entry marked
`exited-with-subordinates` after quit. The fixed app installs the production
quit policy. It remains in the Dock while open and while its first quit is
deferred, then becomes a `UIElement` at final quit. Its independent child remains
alive, without a foreground app entry that macOS 27 would show in the Dock.

The printed evidence directory contains a receipt, per-app lifecycle snapshots,
Launch Services records, and logs. Cleanup terminates only the fixture's recorded
processes. These checks verify Electron Dock visibility and macOS application
types, not physical Dock clicks, updater installation, or recovery of a Dock
entry left by an already-exited older build.

Apple documents the background indicator and accessory application behavior in
[Managing ongoing background processes](https://developer.apple.com/documentation/appkit/managing-ongoing-background-processes-in-your-mac).
