export async function ensureDeps() {
  if (typeof require !== "function") {
    throw new Error("Photoshop host dependencies are unavailable");
  }

  const photoshop = require("photoshop");
  const uxp = require("uxp");
  if (!photoshop || !uxp || !uxp.storage) {
    throw new Error("Photoshop or UXP storage module is unavailable");
  }

  return {
    photoshop,
    storage: uxp.storage
  };
}

export async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download result (HTTP ${response.status})`);
  }
  return response.arrayBuffer();
}
