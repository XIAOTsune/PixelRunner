const store = require("../../services/store");
const runninghub = require("../../services/runninghub");
const photoshop = require("../../services/ps.js");

function createWorkspaceGateway(options = {}) {
  return {
    store: options.store || store,
    runninghub: options.runninghub || runninghub,
    photoshop: options.photoshop || photoshop
  };
}

module.exports = {
  createWorkspaceGateway
};
