function toggleSectionCollapse(sectionEl, toggleEl, options = {}) {
  if (!sectionEl || !toggleEl) return false;

  const collapsedClass = String(options.collapsedClass || "is-collapsed");
  const expandText = String(options.expandText || "展开");
  const collapseText = String(options.collapseText || "收起");
  const isCollapsed = sectionEl.classList.contains(collapsedClass);

  if (isCollapsed) {
    sectionEl.classList.remove(collapsedClass);
    toggleEl.textContent = collapseText;
    return true;
  }

  sectionEl.classList.add(collapsedClass);
  toggleEl.textContent = expandText;
  return false;
}

module.exports = {
  toggleSectionCollapse
};
