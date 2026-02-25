const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkspaceLogController } = require("../../../src/controllers/workspace/workspace-log-controller");

test("workspace log controller writes console and renders log line", () => {
  const calls = {
    console: [],
    lines: []
  };
  const logWindow = {};
  const controller = createWorkspaceLogController({
    dom: { logWindow },
    consoleLog: (message) => {
      calls.console.push(String(message || ""));
    },
    buildLogLine: ({ message, type }) => `${type}:${message}`,
    renderLogLine: (target, line) => {
      calls.lines.push({ target, line });
    }
  });

  controller.log("hello", "warn");

  assert.deepEqual(calls.console, ["[Workspace][warn] hello"]);
  assert.equal(calls.lines.length, 1);
  assert.equal(calls.lines[0].target, logWindow);
  assert.equal(calls.lines[0].line, "warn:hello");
});

test("workspace log controller clears log window via clear action", () => {
  const calls = {
    cleared: 0
  };
  const logWindow = {};
  const controller = createWorkspaceLogController({
    dom: { logWindow },
    consoleLog: () => {},
    clearLogView: (target) => {
      if (target === logWindow) {
        calls.cleared += 1;
      }
    },
    renderLogLine: () => {
      throw new Error("renderLogLine should not run for clear action");
    }
  });

  controller.onClearLogClick();

  assert.equal(calls.cleared, 1);
});

test("workspace log controller emits prompt length summary lines", () => {
  const calls = {
    lines: []
  };
  const controller = createWorkspaceLogController({
    dom: { logWindow: {} },
    buildPromptLengthLogSummary: () => ({
      totalPromptInputs: 2,
      entries: [
        { label: "Prompt A", key: "promptA", length: 12, tail: "tailA" },
        { label: "Prompt B", key: "promptB", length: 34, tail: "tailB" }
      ],
      hiddenCount: 1
    }),
    buildLogLine: ({ message }) => String(message || ""),
    renderLogLine: (_target, line) => {
      calls.lines.push(line);
    },
    consoleLog: () => {}
  });

  controller.logPromptLengthsBeforeRun({ id: "app-1" }, { promptA: "x", promptB: "y" }, "[Job:J-1]");

  assert.equal(calls.lines.length, 4);
  assert.match(calls.lines[0], /\[Job:J-1\] Prompt length check before run/);
  assert.match(calls.lines[1], /Prompt A \(promptA\): length 12/);
  assert.match(calls.lines[2], /Prompt B \(promptB\): length 34/);
  assert.match(calls.lines[3], /additional prompt input\(s\) not expanded/);
});

test("workspace log controller skips prompt logging when summary is empty", () => {
  const calls = {
    lines: []
  };
  const controller = createWorkspaceLogController({
    dom: { logWindow: {} },
    buildPromptLengthLogSummary: () => null,
    buildLogLine: ({ message }) => String(message || ""),
    renderLogLine: (_target, line) => {
      calls.lines.push(line);
    },
    consoleLog: () => {}
  });

  controller.logPromptLengthsBeforeRun({ id: "app-1" }, { prompt: "" }, "[Job:J-2]");

  assert.deepEqual(calls.lines, []);
});
