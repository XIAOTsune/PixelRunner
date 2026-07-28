# PixelRunner Offline License

PixelRunner 2.8.0 uses an offline Ed25519 signature for permanent licenses. The
plugin contains public verification keys only. It does not collect hardware
serial numbers, MAC addresses, CPU IDs, or invasive machine fingerprints.

On its first run, the plugin creates a cryptographically random installation ID
in existing UXP local storage. The stable device code shown in Settings is a
one-way display form derived from that ID. A license binds to a hash of that
device code, not to the raw installation ID.

## License Format

The copy-and-paste activation code is:

```text
PRL2.<base64url canonical payload>.<base64url Ed25519 signature>
```

The signed canonical payload contains these exact fields:

```text
schemaVersion, productId, licenseId, deviceCodeHash, features,
issuedAt, permanent, keyId
```

`productId` is `com.tsune.pixelrunner`; `permanent` is always `true`. Supported
feature IDs are `glow`, `spaceFx`, `blendMatch`, and `localUpscale`.

## Developer Workflow

Generate an Ed25519 key pair only into an explicit path outside this repository:

```powershell
node .\scripts\generate-license-keypair.mjs --private-key-file D:\PixelRunnerKeys\pixelrunner-ed25519-private.pem
```

The script refuses project paths and prints only the public key. Add that public
key under a new `keyId` in `src/shared/license-public-keys.js`; never add the
private PEM, an environment dump, or a copied key to the repository, bundle,
release archive, fixtures, or logs.

Issue a permanent activation code locally after receiving the user's device code:

```powershell
node .\scripts\issue-license.mjs `
  --private-key-file D:\PixelRunnerKeys\pixelrunner-ed25519-private.pem `
  --key-id pr-2026-01 `
  --license-id PR-2026-000001 `
  --device-code PR2-XXXX-XXXX-XXXX-XXXX-XXXX `
  --features glow,spaceFx,blendMatch,localUpscale
```

The signing script accepts a PEM from either the explicit external file path or
the `PIXELRUNNER_LICENSE_PRIVATE_KEY_PEM` environment variable. It never writes
a supplied private key into the project.

## Migration And Limits

Each permanent license is for one device code. For a device migration, the user
provides the code from the new installation and the developer manually issues a
new license. This is reissuance, not remote revocation.

There is no online activation or revocation service. A purely offline permanent
license cannot remotely revoke an old license that has already leaked. Release
obfuscation only raises the cost of casual modification; it does not encrypt
client-side code or turn an offline client into a remotely controllable system.
