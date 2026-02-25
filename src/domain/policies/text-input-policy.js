const LARGE_PROMPT_WARNING_CHARS = 4000;
const TEXT_INPUT_HARD_MAX_CHARS = 20000;

function getTextLength(value) {
  return Array.from(String(value == null ? "" : value)).length;
}

function getTailPreview(value, maxChars = 20) {
  const chars = Array.from(String(value == null ? "" : value));
  if (chars.length === 0) return "(空)";
  const tail = chars.slice(Math.max(0, maxChars > 0 ? chars.length - maxChars : chars.length)).join("");
  const singleLineTail = tail.replace(/\r/g, "").replace(/\n/g, "\\n");
  return chars.length > maxChars ? `...${singleLineTail}` : singleLineTail;
}

function enforceLongTextCapacity(inputEl, maxLength = TEXT_INPUT_HARD_MAX_CHARS) {
  if (!inputEl) return;
  const safeMaxLength = Math.max(1, Number(maxLength) || TEXT_INPUT_HARD_MAX_CHARS);
  try {
    inputEl.maxLength = safeMaxLength;
  } catch (_) {}
  try {
    inputEl.setAttribute("maxlength", String(safeMaxLength));
  } catch (_) {}
}

function insertTextAtCursor(inputEl, rawText) {
  if (!inputEl) return;
  const text = String(rawText == null ? "" : rawText);
  const current = String(inputEl.value || "");
  const start = Number.isFinite(inputEl.selectionStart) ? inputEl.selectionStart : current.length;
  const end = Number.isFinite(inputEl.selectionEnd) ? inputEl.selectionEnd : start;
  const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
  inputEl.value = next;
  const cursor = start + text.length;
  if (typeof inputEl.setSelectionRange === "function") {
    inputEl.setSelectionRange(cursor, cursor);
  }
}

module.exports = {
  LARGE_PROMPT_WARNING_CHARS,
  TEXT_INPUT_HARD_MAX_CHARS,
  getTextLength,
  getTailPreview,
  enforceLongTextCapacity,
  insertTextAtCursor
};
