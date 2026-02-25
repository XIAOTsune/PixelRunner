const test = require("node:test");
const assert = require("node:assert/strict");
const { parseJsonFromEscapedText } = require("../../../src/services/runninghub-parser/json-utils");
const { collectSourceCandidates } = require("../../../src/services/runninghub-parser/source-candidate-strategy");

test("collectSourceCandidates scans nested known keys and escaped json payloads", () => {
  const result = {
    data: "{\\\"nodeInfoList\\\":[{\\\"fieldName\\\":\\\"prompt\\\",\\\"key\\\":\\\"k1\\\"}]}",
    result: {
      payload: {
        inputs: [{ fieldName: "negative_prompt", key: "k2" }]
      }
    }
  };

  const candidates = collectSourceCandidates(result, { parseJsonFromEscapedText });
  const hasNodeInfoListArray = candidates.some(
    (item) => Array.isArray(item) && item.length === 1 && item[0] && item[0].fieldName === "prompt"
  );
  const hasPayloadObject = candidates.some((item) => !Array.isArray(item) && item && item.inputs);

  assert.equal(hasNodeInfoListArray, true);
  assert.equal(hasPayloadObject, true);
});

test("collectSourceCandidates deduplicates array candidates with identical shape", () => {
  const result = {
    data: { inputs: [{ key: "a", fieldName: "prompt" }] },
    result: { inputs: [{ key: "b", fieldName: "negative_prompt" }] }
  };

  const candidates = collectSourceCandidates(result, { parseJsonFromEscapedText });
  const arrayCandidates = candidates.filter(Array.isArray);

  assert.equal(arrayCandidates.length, 1);
  assert.equal(arrayCandidates[0].length, 1);
});
