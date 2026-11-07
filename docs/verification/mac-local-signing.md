# Persistent signing for local macOS builds

`pnpm package:mac:local` builds an unpacked app for the current Mac and signs all
of its nested code with one persistent self-signed certificate. The bundle ID
stays `com.alkamin.openmausbot`; standalone helpers get identifiers derived from
their path inside the bundle, independent of output directories or binary UUIDs.
The command verifies the app, speech helper and CUA driver with `codesign`, checks
their certificate, and refuses hash-based designated requirements.

Install successive builds at `/Applications/OpenMausBot.app`, after quitting
the running app. If the installed local app has a `fork-use-existing-setup`
marker, the next local build preserves that choice before signing, so installing
an update keeps the same workspace and desktop profile. Grant macOS privacy permissions once after switching from an
ad-hoc or differently signed build. Switching back to a release can require
approval again. A stable identity preserves eligibility for existing grants;
macOS still controls when permissions must be approved.

## Certificate storage

The first invocation creates a code-signing certificate and private key in a
dedicated keychain under
`~/Library/Application Support/OpenMausBot/Local Signing`. The directory is
owner-only; its unlock password is stored there in an owner-only file. Temporary
private-key and PKCS#12 files are removed after import. The imported key permits
`/usr/bin/codesign` with Apple's tool partitions, without unrestricted `-A` access. This
command does not disable Gatekeeper, change system trust, reset privacy grants,
or install or launch the app.

`pnpm setup:mac-local-signing` creates or checks the certificate without building.
Keep this directory across checkouts, clean builds and worktrees. An incomplete
identity causes an error instead of generating a replacement. Losing this key
means approving permissions again with a new identity. These local builds are
not for distribution; `pnpm package:mac` and CI keep the release signing flow.

Apple explains why an ad-hoc signature cannot preserve privacy authorizations
in [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
and describes self-signed identities for internal development in
[Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html).

## Isolated verification

```sh
OMB_MAC_SIGN_E2E=1 pnpm exec vitest run scripts/mac-local-signing.test.mjs scripts/mac-local-signing.e2e.test.mjs
```

The macOS fixture creates a throwaway certificate and keychain, compiles a tiny
app with a nested speech app and standalone driver, and signs two different
versions. It asserts that their executable hashes change while their designated
requirements and certificate remain identical. A second setup reuses the key;
missing identity metadata is refused. Cleanup deletes only the fixture keychain
and its own temporary directory. It never opens the user's app or accesses their
chat data. It verifies signing continuity, not macOS's privacy prompts themselves.

The focused tests also load the speech build module from a directory without
repository build scripts, matching its packaged runtime boundary.

After a local Apple silicon build, check the bundled server with the signed
Electron runtime in another disposable home:

```sh
ELECTRON_RUN_AS_NODE=1 \
  OMB_SMOKE_DIST="$PWD/release/local/mac-arm64/OpenMausBot.app/Contents/Resources/server" \
  release/local/mac-arm64/OpenMausBot.app/Contents/MacOS/OpenMausBot scripts/smoke-packaged-server.mjs
```

Use `release/local/mac` on Intel. The fixture preserves Electron's Node mode in
every child so the test does not open the desktop app.
