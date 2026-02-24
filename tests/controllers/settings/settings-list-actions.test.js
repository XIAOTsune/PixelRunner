const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getActionButton,
  resolveSavedItemId,
  resolveSavedAppsListAction,
  resolveSavedTemplatesListAction
} = require("../../../src/controllers/settings/settings-list-actions");

function createButton(action, id) {
  return {
    dataset: {
      action,
      id
    }
  };
}

test("getActionButton returns button only when inside container", () => {
  const button = createButton("edit-app", "enc-a1");
  const container = {
    contains: (node) => node === button
  };
  const event = {
    target: {
      closest: () => button
    }
  };
  assert.equal(getActionButton(event, container), button);
  assert.equal(
    getActionButton(event, {
      contains: () => false
    }),
    null
  );
});

test("resolveSavedItemId prefers button id and falls back to row id", () => {
  const button = createButton("edit-app", "enc-a1");
  assert.equal(
    resolveSavedItemId(button, {
      decodeDataId: (value) => (value === "enc-a1" ? "a1" : ""),
      findClosestByClass: () => ({ dataset: { id: "enc-row" } })
    }),
    "a1"
  );

  const buttonNoId = createButton("delete-app", "");
  assert.equal(
    resolveSavedItemId(buttonNoId, {
      decodeDataId: (value) => (value === "enc-row" ? "row-id" : ""),
      findClosestByClass: () => ({ dataset: { id: "enc-row" } })
    }),
    "row-id"
  );
});

test("resolveSavedAppsListAction resolves edit/delete and none", () => {
  const button = createButton("edit-app", "enc-a1");
  const event = {
    target: {
      closest: () => button
    }
  };
  const result = resolveSavedAppsListAction(event, {
    container: { contains: () => true },
    decodeDataId: (value) => (value === "enc-a1" ? "a1" : ""),
    findClosestByClass: () => null
  });
  assert.deepEqual(result, { kind: "edit-app", id: "a1" });

  const deleteButton = createButton("delete-app", "enc-a2");
  const deleteResult = resolveSavedAppsListAction(
    {
      target: {
        closest: () => deleteButton
      }
    },
    {
      container: { contains: () => true },
      decodeDataId: (value) => (value === "enc-a2" ? "a2" : ""),
      findClosestByClass: () => null
    }
  );
  assert.deepEqual(deleteResult, { kind: "delete-app", id: "a2" });

  const none = resolveSavedAppsListAction(
    {
      target: {
        closest: () => null
      }
    },
    {
      container: { contains: () => true },
      decodeDataId: (value) => value,
      findClosestByClass: () => null
    }
  );
  assert.deepEqual(none, { kind: "none", id: "" });
});

test("resolveSavedTemplatesListAction resolves edit/delete and none", () => {
  const editButton = createButton("edit-template", "enc-t1");
  const editResult = resolveSavedTemplatesListAction(
    {
      target: {
        closest: () => editButton
      }
    },
    {
      container: { contains: () => true },
      decodeDataId: (value) => (value === "enc-t1" ? "t1" : "")
    }
  );
  assert.deepEqual(editResult, { kind: "edit-template", id: "t1" });

  const deleteButton = createButton("delete-template", "enc-t2");
  const deleteResult = resolveSavedTemplatesListAction(
    {
      target: {
        closest: () => deleteButton
      }
    },
    {
      container: { contains: () => true },
      decodeDataId: (value) => (value === "enc-t2" ? "t2" : "")
    }
  );
  assert.deepEqual(deleteResult, { kind: "delete-template", id: "t2" });

  const none = resolveSavedTemplatesListAction(
    {
      target: {
        closest: () => null
      }
    },
    {
      container: { contains: () => true },
      decodeDataId: (value) => value
    }
  );
  assert.deepEqual(none, { kind: "none", id: "" });
});
