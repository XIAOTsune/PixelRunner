const capture = require("./ps/capture");
const place = require("./ps/place");
const tools = require("./ps/tools");

module.exports = {
  ...capture,
  ...place,
  ...tools
};
