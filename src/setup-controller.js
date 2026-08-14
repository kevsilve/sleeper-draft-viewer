export function bindSetupController({
  changebtn,
  connectBtn,
  detectBtn,
  detectDraftsForUsername,
  draftIdInput,
  draftlist,
  escapeHtml,
  extractDraftId,
  fmtDraftDate,
  setupErr,
  setupscreen,
  usernameInput,
  validateDraft
}) {
  async function connectDraft(draftId) {
    setupErr.textContent = "";
    try {
      const normalized = extractDraftId(String(draftId || "").trim());
      await validateDraft(normalized);
      try { localStorage.setItem("draft-viewer-last-draft", normalized); } catch {}
      const nextUrl = new URL(location.href);
      nextUrl.searchParams.set("draft", normalized);
      location.assign(nextUrl);
    } catch (err) {
      setupErr.textContent = err.message;
    }
  }

  async function runDetect() {
    const username = usernameInput.value.trim();
    if (!username) return;
    setupErr.textContent = "";
    draftlist.innerHTML = '<div class="setupmsg">Searching...</div>';
    detectBtn.disabled = true;
    try {
      const data = await detectDraftsForUsername(username);
      try { localStorage.setItem("draft-viewer-last-username", username); } catch {}
      if (!data.drafts || data.drafts.length === 0) {
        draftlist.innerHTML = '<div class="setupmsg">No drafts found for that username.</div>';
        return;
      }
      draftlist.innerHTML = "";
      const kindLabel = { league: "League Draft", practice: "Practice Draft", mock: "Mock Draft" };
      const sectionLabel = { league: "League Drafts", practice: "Practice Drafts", mock: "Mock Drafts" };
      const groups = { league: [], practice: [], mock: [] };
      data.drafts.forEach((draft) => { (groups[draft.kind] || groups.mock).push(draft); });

      const perSection = 8;
      ["league", "practice", "mock"].forEach((kind) => {
        const items = groups[kind];
        if (!items.length) return;
        const heading = document.createElement("div");
        heading.className = "draftsection";
        heading.textContent = `${sectionLabel[kind]} (${items.length})`;
        draftlist.appendChild(heading);

        items.slice(0, perSection).forEach((draft) => {
          const card = document.createElement("div");
          card.className = "draftcard";
          const title = draft.league_name || draft.metadata_name || kindLabel[draft.kind] || "Draft";
          const draftKind = kindLabel[draft.kind] || "Draft";
          card.innerHTML = `
            <div>
              <div class="dname">${escapeHtml(title)} <span class="dkind ${draft.kind}">${draftKind}</span></div>
              <div class="dmeta">${draft.teams || "?"} teams · ${draft.rounds || "?"} rounds · ${escapeHtml(fmtDraftDate(draft.start_time || draft.created))} · ${escapeHtml(draft.draft_id)}</div>
            </div>
            <div class="dstatus ${draft.status}">${draft.status.replace("_", " ")}</div>
          `;
          card.onclick = () => connectDraft(draft.draft_id);
          draftlist.appendChild(card);
        });

        if (items.length > perSection) {
          const more = document.createElement("div");
          more.className = "setupmsg";
          more.style.margin = "2px 0 6px";
          more.textContent = `+ ${items.length - perSection} more ${sectionLabel[kind].toLowerCase()} not shown`;
          draftlist.appendChild(more);
        }
      });
    } catch (err) {
      setupErr.textContent = err.message;
      draftlist.innerHTML = "";
    } finally {
      detectBtn.disabled = false;
    }
  }

  detectBtn.onclick = runDetect;
  usernameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") runDetect(); });
  connectBtn.onclick = () => {
    const raw = draftIdInput.value.trim();
    if (raw) connectDraft(extractDraftId(raw));
  };
  draftIdInput.addEventListener("keydown", (event) => { if (event.key === "Enter") connectBtn.click(); });
  changebtn.onclick = () => { setupscreen.classList.add("show"); };

  return { connectDraft, runDetect };
}
