// This module intentionally contains public verification keys only. Keep the
// matching Ed25519 private key outside the repository and release package.
export const ACTIVE_LICENSE_KEY_ID = "pr-2026-01";

// Provisioned by scripts/generate-license-keypair.mjs into an external file.
// Rotating a key requires adding its public key here and keeping older public
// keys while their issued licenses must remain valid.
export const LICENSE_PUBLIC_KEYS = Object.freeze({
  [ACTIVE_LICENSE_KEY_ID]: "SuZAfB2h1N0nZ9pUdaEIIf3ZVbZsF-IAX0yfRu3VKko"
});
