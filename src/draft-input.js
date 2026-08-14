function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function fmtDraftDate(ms) {
  if (!ms) return "";
  try { return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return ""; }
}

function extractDraftId(input) {
  const digitsOnly = input.match(/^\d+$/);
  if (digitsOnly) return input;
  const match = input.match(/(\d{15,20})/); // Sleeper draft IDs are long numeric snowflake IDs
  return match ? match[1] : input;
}

export { escapeHtml, extractDraftId, fmtDraftDate };
