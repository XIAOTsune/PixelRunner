const { uploadImage } = require("./upload-strategy");

function createBlankImageTokenProvider(params = {}) {
  const {
    apiKey,
    blankImageValue,
    options = {},
    helpers = {},
    uploadImageImpl
  } = params;
  const safeUploadImage = typeof uploadImageImpl === "function" ? uploadImageImpl : uploadImage;

  let cachedToken = "";
  let pending = null;
  return async () => {
    if (cachedToken) return cachedToken;
    if (!pending) {
      pending = safeUploadImage(apiKey, blankImageValue, options, helpers)
        .then((uploaded) => {
          const nextToken = uploaded && uploaded.value ? String(uploaded.value) : "";
          if (!nextToken) throw new Error("blank image upload returned empty token");
          cachedToken = nextToken;
          return nextToken;
        })
        .catch((error) => {
          pending = null;
          throw error;
        });
    }
    return pending;
  };
}

module.exports = {
  createBlankImageTokenProvider
};
