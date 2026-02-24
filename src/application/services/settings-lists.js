function buildDuplicateMeta(list = []) {
  const items = Array.isArray(list) ? list : [];
  const totals = Object.create(null);
  const occurrences = Object.create(null);

  items.forEach((item) => {
    const key = String((item && item.id) || "unknown-id");
    totals[key] = (totals[key] || 0) + 1;
  });

  return items.map((item) => {
    const key = String((item && item.id) || "unknown-id");
    occurrences[key] = (occurrences[key] || 0) + 1;
    return {
      id: key,
      isDuplicate: totals[key] > 1,
      index: occurrences[key],
      total: totals[key]
    };
  });
}

function buildSavedAppsListViewModel(apps) {
  const items = Array.isArray(apps) ? apps : [];
  if (items.length === 0) {
    return {
      empty: true,
      emptyText: "暂无已保存应用",
      items: []
    };
  }

  const duplicateMeta = buildDuplicateMeta(items);
  return {
    empty: false,
    emptyText: "",
    items: items.map((app, idx) => {
      const meta = duplicateMeta[idx] || {
        id: "",
        isDuplicate: false,
        index: 1,
        total: 1
      };
      const rawId = String((app && app.id) || "");
      return {
        id: rawId,
        name: String((app && app.name) || "未命名应用"),
        appId: String((app && app.appId) || "-"),
        recordId: String(meta.id || ""),
        editDisabled: !rawId,
        deleteDisabled: !rawId,
        duplicate: {
          isDuplicate: !!meta.isDuplicate,
          index: Number(meta.index) || 1,
          total: Number(meta.total) || 1
        }
      };
    })
  };
}

function buildSavedTemplatesListViewModel(templates) {
  const items = Array.isArray(templates) ? templates : [];
  if (items.length === 0) {
    return {
      empty: true,
      emptyText: "暂无模板",
      items: []
    };
  }

  const duplicateMeta = buildDuplicateMeta(items);
  return {
    empty: false,
    emptyText: "",
    items: items.map((template, idx) => {
      const meta = duplicateMeta[idx] || {
        id: "",
        isDuplicate: false,
        index: 1,
        total: 1
      };
      const rawId = String((template && template.id) || "");
      return {
        id: rawId,
        title: String((template && template.title) || "未命名模板"),
        recordId: String(meta.id || ""),
        editDisabled: !rawId,
        deleteDisabled: !rawId,
        duplicate: {
          isDuplicate: !!meta.isDuplicate,
          index: Number(meta.index) || 1,
          total: Number(meta.total) || 1
        }
      };
    })
  };
}

module.exports = {
  buildDuplicateMeta,
  buildSavedAppsListViewModel,
  buildSavedTemplatesListViewModel
};
