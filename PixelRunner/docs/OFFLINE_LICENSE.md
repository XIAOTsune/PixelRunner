# PixelRunner Offline License

PixelRunner 2.8.4 uses an offline Ed25519 signature for permanent licenses. The
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

For the normal external-key workflow, run `npm run build:license-issuer` and
open the root `license-issuer.html` file. It loads no network resources and
asks for the same external PKCS#8 PEM when a code is issued. The page checks
that the selected private key matches the chosen built-in `keyId`; it keeps the
key only in page memory.

For a developer's own offline phone or computer, a deliberately simplified
self-contained page can be generated with one device-code field. It creates a
license ID and signs the current `issuedAt` time automatically, always
unlocking all four supported features:

```powershell
npm run build:personal-license-issuer -- `
  --private-key-file C:\Users\Developer\.pixelrunner\keys\pixelrunner-ed25519-private.pem `
  --out .\像素起子激活码生成器.html `
  --allow-embedded-private-key
```

The explicit final flag is required because this output embeds the private key.
Treat that HTML as a high-sensitivity personal signing device: do not commit,
sync, send, publish, include it in a release, or open it on an untrusted
computer. The build script still requires the source PEM to be outside the
repository and does not print key material. The release package does not use
this file.

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
