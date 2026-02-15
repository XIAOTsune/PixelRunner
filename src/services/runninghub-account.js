function pickAccountValue(raw, keys) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim() !== "") {
      return String(raw[key]).trim();
    }
  }
  return "";
}

async function testApiKeyCore(params = {}) {
  const { apiKey, helpers = {} } = params;
  const { fetchImpl, api, parseJsonResponse, toMessage } = helpers;

  const url = new URL(`${api.BASE_URL}${api.ENDPOINTS.PARSE_APP}`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("webappId", "1");

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
  });
  const result = await parseJsonResponse(response);

  if (response.status === 401) return { ok: false, message: "API Key invalid (401)" };
  if (response.status === 403) return { ok: false, message: "API Key forbidden or insufficient balance (403)" };
  if (result && (result.code === 0 || result.success === true)) return { ok: true, message: "API Key valid" };

  return { ok: response.ok, message: toMessage(result, `HTTP ${response.status}`) };
}

async function fetchAccountStatusCore(params = {}) {
  const { apiKey, helpers = {} } = params;
  const { fetchImpl, api, parseJsonResponse, toMessage } = helpers;

  if (!apiKey) throw new Error("Missing API Key");

  const response = await fetchImpl(`${api.BASE_URL}${api.ENDPOINTS.ACCOUNT_STATUS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: apiKey })
  });
  const result = await parseJsonResponse(response);
  const ok = response.ok && result && (result.code === 0 || result.success === true);
  if (!ok) throw new Error(toMessage(result, `Fetch account status failed (HTTP ${response.status})`));

  const data = result.data || result.result || {};
  const account = (data && data.accountStatus && typeof data.accountStatus === "object" ? data.accountStatus : data) || {};
  return {
    remainMoney: pickAccountValue(account, ["remainMoney", "balance", "money"]),
    remainCoins: pickAccountValue(account, ["remainCoins", "rhCoins", "coins"])
  };
}

module.exports = {
  testApiKeyCore,
  fetchAccountStatusCore
};
