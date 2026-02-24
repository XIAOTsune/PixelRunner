const test = require("node:test");
const assert = require("node:assert/strict");
const { createBlankImageTokenProvider } = require("../../../src/services/runninghub-runner/blank-image-strategy");

test("createBlankImageTokenProvider caches token and reuses pending upload", async () => {
  let calls = 0;
  const provider = createBlankImageTokenProvider({
    apiKey: "api-key",
    blankImageValue: "base64-value",
    uploadImageImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { value: "token-1" };
    }
  });

  const [tokenA, tokenB] = await Promise.all([provider(), provider()]);
  const tokenC = await provider();

  assert.equal(tokenA, "token-1");
  assert.equal(tokenB, "token-1");
  assert.equal(tokenC, "token-1");
  assert.equal(calls, 1);
});

test("createBlankImageTokenProvider throws when upload returns empty token", async () => {
  const provider = createBlankImageTokenProvider({
    apiKey: "api-key",
    blankImageValue: "base64-value",
    uploadImageImpl: async () => ({ value: "" })
  });

  await assert.rejects(
    () => provider(),
    /blank image upload returned empty token/
  );
});

test("createBlankImageTokenProvider allows retry after failure", async () => {
  let calls = 0;
  const provider = createBlankImageTokenProvider({
    apiKey: "api-key",
    blankImageValue: "base64-value",
    uploadImageImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary");
      return { value: "token-2" };
    }
  });

  await assert.rejects(() => provider(), /temporary/);
  const token = await provider();
  assert.equal(token, "token-2");
  assert.equal(calls, 2);
});
