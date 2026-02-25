const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunGuard } = require("../../../src/application/services/run-guard");

test("run guard blocks duplicate fingerprints in the dedup window", () => {
  let now = 1000;
  const guard = createRunGuard({
    dedupWindowMs: 4000,
    dedupCacheLimit: 8,
    now: () => now
  });

  const fingerprint = "fp:1";
  assert.equal(guard.isRecentDuplicateFingerprint(fingerprint), false);

  guard.rememberFingerprint(fingerprint);
  assert.equal(guard.isRecentDuplicateFingerprint(fingerprint), true);

  now += 4001;
  assert.equal(guard.isRecentDuplicateFingerprint(fingerprint), false);
});

test("run guard default dedup window is short-lived for weak dedup", () => {
  let now = 1000;
  const guard = createRunGuard({ now: () => now });
  const fingerprint = "fp:weak";

  guard.rememberFingerprint(fingerprint);

  now = 1700;
  assert.equal(guard.isRecentDuplicateFingerprint(fingerprint), true);

  now = 1801;
  assert.equal(guard.isRecentDuplicateFingerprint(fingerprint), false);
});

test("run guard manages submit lock and click lock", () => {
  let now = 0;
  const guard = createRunGuard({ now: () => now });

  assert.equal(guard.beginSubmit(), true);
  assert.equal(guard.beginSubmit(), false);

  guard.finishSubmit();
  guard.blockClickFor(120);
  assert.equal(guard.isClickGuardActive(), true);

  now = 121;
  assert.equal(guard.isClickGuardActive(), false);
  assert.equal(guard.beginSubmit(), true);
});

test("buildRunFingerprint keeps stable output for equivalent payloads", () => {
  const guard = createRunGuard();
  const sourceBuffer = new Uint8Array([1, 2, 3, 4]).buffer;

  const base = {
    appItem: { id: "app-1" },
    targetBounds: { left: 1, top: 2, right: 3, bottom: 4 },
    sourceBuffer,
    pasteStrategy: "smart",
    uploadMaxEdge: 2048,
    pollSettings: { pollInterval: 2, timeout: 180 }
  };

  const fp1 = guard.buildRunFingerprint({
    ...base,
    inputValues: {
      prompt: "hello",
      options: {
        b: 2,
        a: 1
      }
    }
  });

  const fp2 = guard.buildRunFingerprint({
    ...base,
    inputValues: {
      options: {
        a: 1,
        b: 2
      },
      prompt: "hello"
    }
  });

  assert.equal(fp1, fp2);
});
