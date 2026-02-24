const test = require("node:test");
const assert = require("node:assert/strict");
const {
  toSavedParsedAppData,
  listSavedAppsUsecase,
  findSavedAppByIdUsecase,
  saveParsedAppUsecase,
  loadEditableAppUsecase,
  deleteAppUsecase
} = require("../../../src/application/usecases/manage-apps");

test("toSavedParsedAppData normalizes missing fields", () => {
  assert.deepEqual(toSavedParsedAppData(null), {
    appId: "",
    name: "",
    description: "",
    inputs: []
  });
});

test("listSavedAppsUsecase filters invalid app items", () => {
  const result = listSavedAppsUsecase({
    store: {
      getAiApps: () => [{ id: "a1" }, null, 1, { id: "a2" }]
    }
  });
  assert.deepEqual(result, [{ id: "a1" }, { id: "a2" }]);
});

test("findSavedAppByIdUsecase finds app by id", () => {
  const store = {
    getAiApps: () => [{ id: "a1", name: "App 1" }, { id: "a2", name: "App 2" }]
  };

  assert.deepEqual(
    findSavedAppByIdUsecase({
      store,
      id: "a2"
    }),
    { id: "a2", name: "App 2" }
  );
  assert.equal(
    findSavedAppByIdUsecase({
      store,
      id: "missing"
    }),
    null
  );
});

test("saveParsedAppUsecase updates existing record by normalized app id", () => {
  const calls = [];
  const store = {
    getAiApps: () => [
      { id: "a1", appId: "https://www.runninghub.cn/workflow/123?foo=1", name: "old" }
    ],
    updateAiApp: (id, payload) => calls.push(["updateAiApp", id, payload]),
    addAiApp: (payload) => {
      calls.push(["addAiApp", payload]);
      return "new-id";
    }
  };
  const parsedAppData = {
    appId: "123",
    name: "new",
    description: "",
    inputs: []
  };

  const result = saveParsedAppUsecase({
    store,
    parsedAppData
  });

  assert.deepEqual(result, {
    reason: "updated",
    targetAppId: "a1",
    targetWorkflowId: "123"
  });
  assert.deepEqual(calls, [["updateAiApp", "a1", parsedAppData]]);
});

test("saveParsedAppUsecase inserts when app id is new", () => {
  const calls = [];
  const store = {
    getAiApps: () => [{ id: "a1", appId: "111" }],
    updateAiApp: () => calls.push(["updateAiApp"]),
    addAiApp: (payload) => {
      calls.push(["addAiApp", payload]);
      return "a2";
    }
  };
  const parsedAppData = {
    appId: "222",
    name: "App 2",
    description: "d",
    inputs: [{ key: "prompt" }]
  };

  const result = saveParsedAppUsecase({
    store,
    parsedAppData
  });

  assert.deepEqual(result, {
    reason: "saved",
    targetAppId: "a2",
    targetWorkflowId: "222"
  });
  assert.deepEqual(calls, [["addAiApp", parsedAppData]]);
});

test("loadEditableAppUsecase builds editable state", () => {
  const result = loadEditableAppUsecase({
    app: {
      id: "a1",
      appId: "w1",
      name: "App 1",
      description: "desc",
      inputs: [{ key: "k" }]
    }
  });

  assert.deepEqual(result, {
    found: true,
    appId: "w1",
    appName: "App 1",
    currentEditingAppId: "a1",
    parsedAppData: {
      appId: "w1",
      name: "App 1",
      description: "desc",
      inputs: [{ key: "k" }]
    }
  });
});

test("deleteAppUsecase deletes by id and handles missing id", () => {
  const deletedIds = [];
  const store = {
    deleteAiApp: (id) => {
      deletedIds.push(id);
      return id === "ok";
    }
  };

  assert.deepEqual(
    deleteAppUsecase({
      store,
      id: "ok"
    }),
    {
      deleted: true,
      id: "ok"
    }
  );

  assert.deepEqual(
    deleteAppUsecase({
      store,
      id: "missing"
    }),
    {
      deleted: false,
      id: "missing"
    }
  );

  assert.deepEqual(
    deleteAppUsecase({
      store,
      id: ""
    }),
    {
      deleted: false,
      id: ""
    }
  );

  assert.deepEqual(deletedIds, ["ok", "missing"]);
});
