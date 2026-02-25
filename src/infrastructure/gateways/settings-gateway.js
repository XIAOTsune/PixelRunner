const store = require("../../services/store");
const runninghub = require("../../services/runninghub");

function createSettingsGateway(options = {}) {
  const storage =
    options.storage !== undefined
      ? options.storage
      : typeof localStorage !== "undefined"
      ? localStorage
      : null;

  return {
    ...store,
    testApiKey: (...args) => runninghub.testApiKey(...args),
    fetchAppInfo: (...args) => runninghub.fetchAppInfo(...args),
    getStorage: () => storage
  };
}

module.exports = {
  createSettingsGateway
};
