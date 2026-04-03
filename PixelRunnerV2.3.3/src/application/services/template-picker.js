const textInputPolicy = require("../../domain/policies/text-input-policy");

function normalizeTemplatePickerConfig(config, options = {}) {
  const maxCombineCount = Math.max(1, Number(options.maxCombineCount) || 5);
  const normalized =
    typeof config === "function"
      ? { onApply: config, mode: "single", maxSelection: 1 }
      : config && typeof config === "object"
      ? config
      : {};
  const mode = normalized.mode === "multiple" ? "multiple" : "single";
  const rawMaxSelection = Number(normalized.maxSelection);
  const maxSelection =
    mode === "multiple"
      ? Math.max(
          1,
          Math.min(maxCombineCount, Number.isFinite(rawMaxSelection) ? Math.floor(rawMaxSelection) : maxCombineCount)
        )
      : 1;

  return {
    mode,
    maxSelection,
    onApply: typeof normalized.onApply === "function" ? normalized.onApply : null
  };
}

function sanitizeTemplateSelectionIds(selectedIds, templates) {
  const currentIds = new Set(
    (Array.isArray(templates) ? templates : []).map((template) => String((template && template.id) || ""))
  );
  return (Array.isArray(selectedIds) ? selectedIds : [])
    .map((id) => String(id || ""))
    .filter((id) => id && currentIds.has(id));
}

function toggleTemplateSelection(options = {}) {
  const marker = String(options.id || "").trim();
  const maxSelection = Math.max(1, Number(options.maxSelection) || 1);
  const selected = (Array.isArray(options.selectedIds) ? options.selectedIds : []).map((id) => String(id || ""));

  if (!marker) {
    return {
      selectedIds: selected,
      limitReached: false,
      changed: false
    };
  }

  const index = selected.indexOf(marker);
  if (index >= 0) {
    selected.splice(index, 1);
    return {
      selectedIds: selected,
      limitReached: false,
      changed: true
    };
  }

  if (selected.length >= maxSelection) {
    return {
      selectedIds: selected,
      limitReached: true,
      changed: false
    };
  }

  selected.push(marker);
  return {
    selectedIds: selected,
    limitReached: false,
    changed: true
  };
}

function resolveSelectedTemplates(options = {}) {
  const templates = Array.isArray(options.templates) ? options.templates : [];
  const selectedIds = (Array.isArray(options.selectedIds) ? options.selectedIds : []).map((id) => String(id || ""));
  return selectedIds
    .map((id) => templates.find((template) => String((template && template.id) || "") === id))
    .filter(Boolean);
}

function buildSingleTemplateSelectionPayload(options = {}) {
  const template = options.template;
  const maxChars = Math.max(1, Number(options.maxChars) || 4000);
  const content = String((template && template.content) || "");
  const length = textInputPolicy.getTextLength(content);
  return {
    mode: "single",
    templates: template ? [template] : [],
    content,
    length,
    limit: maxChars
  };
}

function buildMultipleTemplateSelectionPayload(options = {}) {
  const templates = resolveSelectedTemplates(options);
  const maxChars = Math.max(1, Number(options.maxChars) || 4000);

  if (!Array.isArray(options.selectedIds) || options.selectedIds.length === 0) {
    return {
      ok: false,
      reason: "empty_selection"
    };
  }
  if (templates.length === 0) {
    return {
      ok: false,
      reason: "templates_not_found"
    };
  }

  const content = templates.map((template) => String((template && template.content) || "")).join("\n");
  const length = textInputPolicy.getTextLength(content);
  if (length > maxChars) {
    return {
      ok: false,
      reason: "too_long",
      length,
      limit: maxChars
    };
  }

  return {
    ok: true,
    payload: {
      mode: "multiple",
      templates,
      content,
      length,
      limit: maxChars
    }
  };
}

function buildTemplatePickerUiState(options = {}) {
  const mode = options.mode === "multiple" ? "multiple" : "single";
  const selectedCount = Math.max(0, Number(options.selectedCount) || 0);
  const maxSelection = Math.max(1, Number(options.maxSelection) || 1);
  const multipleMode = mode === "multiple";
  return {
    title: multipleMode ? "Select Prompt Templates (Combine)" : "Select Prompt Template",
    actionsDisplay: multipleMode ? "flex" : "none",
    selectionInfoText: multipleMode ? `Selected ${selectedCount} / ${maxSelection}` : "",
    applyDisabled: multipleMode ? selectedCount === 0 : true
  };
}

function buildTemplatePickerListViewModel(options = {}) {
  const templates = Array.isArray(options.templates) ? options.templates : [];
  const selectedSet = new Set((Array.isArray(options.selectedIds) ? options.selectedIds : []).map((id) => String(id || "")));
  const multipleMode = !!options.multipleMode;

  if (!templates.length) {
    return {
      empty: true,
      emptyState: {
        message: "No templates available. Add templates in Settings.",
        actionLabel: "Go to Settings"
      },
      items: []
    };
  }

  const items = templates.map((template) => {
    const id = String((template && template.id) || "");
    const selected = selectedSet.has(id);
    return {
      id,
      title: String((template && template.title) || ""),
      content: String((template && template.content) || ""),
      selected,
      actionLabel: multipleMode ? (selected ? "Selected" : "Select") : "Select"
    };
  });

  return {
    empty: false,
    emptyState: null,
    items
  };
}

module.exports = {
  normalizeTemplatePickerConfig,
  sanitizeTemplateSelectionIds,
  toggleTemplateSelection,
  resolveSelectedTemplates,
  buildSingleTemplateSelectionPayload,
  buildMultipleTemplateSelectionPayload,
  buildTemplatePickerUiState,
  buildTemplatePickerListViewModel
};
