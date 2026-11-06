# Personal fork

This branch starts at upstream `v0.1.143` (`c8e40ffbb93c31f0260d9c4bffb4d8d3ffd0a85f`).
The repository and desktop update feed point to `alkamin/OpenMausBot`. The app
has its own bundle identifier, `com.alkamin.openmausbot`. Its application name
stays `OpenMausBot` for compatibility with the existing macOS credential store.

## Launch modes

Launching normally creates a separate profile under
`~/Library/Application Support/openmausbot-fork`. Override its root with
`OMB_FORK_PROFILE_ROOT`; the desktop profile, workspace, logs, and crash reports
stay beneath that root. This mode does not copy an existing setup.

To use the installed setup after backing it up and quitting the original app:

```sh
open -n -a "/path/to/OpenMausBot Fork.app" --args --fork-use-existing-setup
```

This explicit flag retains Electron's original desktop profile location and
the original workspace location. It preserves existing paths, browser profiles,
provider login homes, saved secrets, and connected-app installation identity.
The original app and the fork must not use that setup at the same time. Quit
the fork before returning to the original app.

A local build can include an empty `Resources/fork-use-existing-setup` marker
before signing to make that bundle use the existing setup on a normal launch.
Credential-only checks always use their separate profile, including in such a
bundle. The marker contains no credentials or user paths.

Before switching, fully quit OpenMausBot and take private filesystem backups of
both `~/.openmausbot` and `~/Library/Application Support/openmausbot`. Settings
exports omit credentials and connections. Keep the raw backups outside Git.
Only grant the fork Keychain access after reviewing the macOS prompt. A local
ad hoc signature is not the upstream developer's signature or notarization;
future builds may prompt again.

## Credential check

Copy only the encrypted `credentials.bin` into a private, separate profile's
`desktop` directory. Then run:

```sh
open -n -a "/path/to/OpenMausBot Fork.app" \
  --env OMB_FORK_PROFILE_ROOT=/absolute/path/to/private-check-profile \
  --args --fork-check-credentials
```

The app writes `credential-check.json` under the selected profile and exits.
The report contains status, a count, and connection-identity presence flags.
It never contains credential values. This mode does not start the application
server, bots, or connected-app service requests. A successful decryption check
does not establish whether an upstream OAuth grant is still valid.

`electron/fork-credential-probe.mjs` is an alternative entry point for a
dedicated local check bundle. It reads a build-local `Resources/fork-check.json`
containing `{ "profileRoot": "/absolute/private/check/profile" }` and selects
the same credential-only mode. Do not include private profiles in a release.

## Verification

Run the focused credential and bootstrap tests:

```sh
pnpm exec vitest run electron/fork-entry.test.mjs \
  electron/secure-credentials.test.mjs electron/secure-credential-state.test.mjs \
  electron/workspace-credentials.test.mjs electron/managed-composio.test.mjs \
  electron/updater.test.mjs
node --test electron/fork-profile.node-test.mjs
pnpm build
pnpm build:server
node scripts/smoke-packaged-server.mjs
```

The packaged-server smoke also runs in an isolated Podman container with the
repository mounted read-only and no real credentials. Follow
`docs/verification/README.md` for other server changes. A native macOS check is
needed to establish actual Keychain compatibility.
