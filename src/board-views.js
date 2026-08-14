export function createBoardViews({
  POS_COLORS,
  POS_ORDER,
  avatarHtml,
  escapeHtml,
  getState,
  grid,
  gridbtn,
  gridview,
  isRevealing,
  pickPosition,
  preloadTeamLogo,
  renderClock,
  setTeamsOrder,
  spotlight,
  synergyForPick,
  teamLogoUrl,
  teamsbtn,
  teamgrid,
  teamview,
  ticker
}) {
  let allPicks = [];
  let teamsOrder = [];
  let currentTeams = 12;
  let currentRounds = null;
  let latestClock = null;
  let viewMode = "grid";
  let gridRenderKey = "";
  let teamRenderKey = "";
  let spotlightDormantTimer = null;

  function syncState() {
    ({ allPicks, teamsOrder, currentTeams, currentRounds, latestClock } = getState());
  }

  function invalidateBoardViews() {
    gridRenderKey = "";
    teamRenderKey = "";
  }

  function showRestingView() {
    spotlight.classList.remove("active");
    clearTimeout(spotlightDormantTimer);
    spotlightDormantTimer = setTimeout(() => {
      if (!spotlight.classList.contains("active")) spotlight.classList.add("dormant");
    }, 520);
    if (viewMode === "teams") {
      teamview.classList.add("active");
      gridview.classList.remove("active");
      renderTeamView();
    } else {
      gridview.classList.add("active");
      teamview.classList.remove("active");
      renderGrid();
    }
  }

  function setViewMode(mode) {
    viewMode = mode;
    gridbtn.classList.toggle("active", mode === "grid");
    teamsbtn.classList.toggle("active", mode === "teams");
    if (!isRevealing()) showRestingView();
  }

  function applyTeamsOrder(nextTeamsOrder, nextClock) {
    teamsOrder = nextTeamsOrder || teamsOrder;
    setTeamsOrder(teamsOrder);
    invalidateBoardViews();
    if (nextClock) {
      renderClock(nextClock);
    } else {
      renderGrid();
      renderTeamView();
    }
  }

  // ==================================================
  // TICKER
  // ==================================================
  function tickerExperienceTag(pick) {
    if (pick?.player?.is_rookie) return '<span class="rk">R</span>';
    if (pick?.player?.is_veteran) return '<span class="vt">VET</span>';
    return "";
  }

  function tickerLine(pick, history = allPicks) {
    const synergy = synergyForPick(pick, history);
    if (synergy && synergy.type !== "pair") {
      return `<span class="p">R${pick.round}.${pick.pick_no}</span> <span class="syn">${escapeHtml(synergy.label)}</span> <b>${escapeHtml(pick.team_name || pick.team_owner)}</b> · ${escapeHtml(synergy.main)}${tickerExperienceTag(pick)}`;
    }
    return `<span class="p">R${pick.round}.${pick.pick_no}</span> <b>${escapeHtml(pick.team_name || pick.team_owner)}</b> → ${escapeHtml(pick.player.name)} (${escapeHtml(pick.player.position || "")})${tickerExperienceTag(pick)}`;
  }

  function addToTicker(pick) {
    if (ticker.dataset.seeded !== "1") { ticker.innerHTML = ""; ticker.dataset.seeded = "1"; }
    const el = document.createElement("span");
    el.className = "item";
    el.innerHTML = tickerLine(pick, allPicks.filter((p) => p.pick_no < pick.pick_no));
    ticker.prepend(el);
    while (ticker.children.length > 12) ticker.removeChild(ticker.lastChild);
  }

  function seedTicker(picks) {
    ticker.innerHTML = "";
    ticker.dataset.seeded = "1";
    if (picks.length === 0) {
      ticker.innerHTML = '<span class="item">Recent picks will appear here...</span>';
      return;
    }
    [...picks].slice(-12).reverse().forEach((pick) => {
      const el = document.createElement("span");
      el.className = "item";
      el.innerHTML = tickerLine(pick, picks);
      ticker.appendChild(el);
    });
  }

  // ==================================================
  // GRID VIEW
  // ==================================================
  function pickNoForRoundSlot(round, slot, teams) {
    return round % 2 === 1 ? (round - 1) * teams + slot : (round - 1) * teams + (teams - slot + 1);
  }

  function gridCellFlags(pick) {
    let html = "";
    if (pick.player.is_rookie) html += `<span class="gtag rookie">R</span>`;
    else if (pick.player.is_veteran) html += `<span class="gtag veteran">VET</span>`;
    return html ? `<div class="gflags">${html}</div>` : "";
  }

  function headerCellHtml(t) {
    const teamName = t.name || t.owner_name || `Team ${t.slot}`;
    const ownerName = t.owner_name || teamName;
    return `<div class="gcell header">
      <div class="avatar" style="width:28px;height:28px;font-size:11px;">${avatarHtml(t.avatar, ownerName)}</div>
      <div class="headertext">
        <div class="hname">${escapeHtml(teamName)}</div>
        ${ownerName !== teamName ? `<div class="howner">${escapeHtml(ownerName)}</div>` : ""}
        <div class="hteam">Pick ${escapeHtml(t.slot)}</div>
      </div>
    </div>`;
  }

  function teamsRenderSignature() {
    return teamsOrder
      .map((t) => `${t.slot}:${t.owner_name || t.name}:${t.avatar || ""}`)
      .join("|");
  }

  function renderGrid() {
    if (!gridview.classList.contains("active")) return;
    if (!teamsOrder.length || !currentRounds) {
      if (gridRenderKey === "empty") return;
      grid.innerHTML = '<div style="padding:40px; color: var(--text-dim); font-size: 20px;">Grid will populate once the draft order is known...</div>';
      gridRenderKey = "empty";
      return;
    }
    const cols = teamsOrder.length;
    const nextPickNo = allPicks.length + 1;
    const nextKey = `${allPicks.length}|${nextPickNo}|${currentRounds}|${teamsRenderSignature()}`;
    if (nextKey === gridRenderKey) return;
    gridRenderKey = nextKey;
    const pickByNo = new Map(allPicks.map((p) => [p.pick_no, p]));

    grid.style.gridTemplateColumns = `50px repeat(${cols}, minmax(130px, 1fr))`;
    let html = `<div class="gcell roundlabel header"></div>`;
    teamsOrder.forEach((t) => { html += headerCellHtml(t); });

    for (let round = 1; round <= currentRounds; round++) {
      html += `<div class="gcell roundlabel">R${round}</div>`;
      for (let slot = 1; slot <= cols; slot++) {
        const pickNo = pickNoForRoundSlot(round, slot, cols);
        const pick = pickByNo.get(pickNo);
        const isCurrent = pickNo === nextPickNo;
        if (pick) {
          const color = POS_COLORS[pick.player.position] || "#555";
          html += `<div class="gcell filled${isCurrent ? " current" : ""}${pick.pick_no === allPicks.length ? " latest" : ""}">
            <div class="gplayer">${escapeHtml(pick.player.name)}</div>
            <div class="gpos" style="background:${color}">${escapeHtml(pick.player.position || "")}</div>
            ${gridCellFlags(pick)}
          </div>`;
        } else {
          html += `<div class="gcell${isCurrent ? " current" : ""}"></div>`;
        }
      }
    }
    grid.innerHTML = html;

    const currentEl = grid.querySelector(".current");
    if (currentEl) currentEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ==================================================
  // TEAM ROSTER VIEW
  // ==================================================
  function renderTeamView() {
    if (!teamview.classList.contains("active")) return;
    if (!teamsOrder.length) {
      if (teamRenderKey === "empty") return;
      teamgrid.innerHTML = '<div style="padding:40px; color: var(--text-dim); font-size: 20px;">Team rosters will populate once the draft order is known...</div>';
      teamRenderKey = "empty";
      return;
    }
    const nextKey = `${allPicks.length}|${teamsRenderSignature()}`;
    if (nextKey === teamRenderKey) return;
    teamRenderKey = nextKey;

    const bySlot = new Map();
    teamsOrder.forEach((t) => bySlot.set(t.slot, []));
    allPicks.forEach((p) => {
      if (!bySlot.has(p.draft_slot)) bySlot.set(p.draft_slot, []);
      bySlot.get(p.draft_slot).push(p);
    });

    let html = "";
    const onClockSlot = latestClock?.pick_no ? slotForPickNo(latestClock.pick_no, currentTeams).slot : null;
    teamsOrder.forEach((t) => {
      const picks = bySlot.get(t.slot) || [];
      const rookieCount = picks.filter((pick) => pick.player.is_rookie).length;
      const veteranCount = picks.filter((pick) => pick.player.is_veteran).length;
      const byPos = {};
      picks.forEach((p) => {
        const pos = p.player.position || "FLEX";
        if (!byPos[pos]) byPos[pos] = [];
        byPos[pos].push(p);
      });
      const positions = Object.keys(byPos).sort(
        (a, b) => (POS_ORDER.indexOf(a) === -1 ? 99 : POS_ORDER.indexOf(a)) - (POS_ORDER.indexOf(b) === -1 ? 99 : POS_ORDER.indexOf(b))
      );

      let rows = "";
      if (positions.length === 0) {
        rows = `<div class="posrow"><span class="posplayers" style="color:var(--text-dim);">No picks yet</span></div>`;
      } else {
        positions.forEach((pos) => {
          const players = byPos[pos]
            .map((p) => `<span class="ply"><b>${escapeHtml(p.player.name)}</b>${p.player.is_rookie ? '<span class="rk"> R</span>' : p.player.is_veteran ? '<span class="vt"> VET</span>' : ""} (R${p.round})</span>`)
            .join(", ");
          rows += `<div class="posrow"><span class="poslabel ${pos}">${pos}</span><span class="posplayers">${players}</span></div>`;
        });
      }

      html += `<div class="teamcard${Number(t.slot) === Number(onClockSlot) ? " on-clock" : ""}">
        <div class="thead">
          <div class="avatar" style="width:34px;height:34px;font-size:12px;">${avatarHtml(t.avatar, t.owner_name || t.name)}</div>
          <div>
            <div class="tname">${escapeHtml(t.name || t.owner_name)}</div>
            ${t.owner_name && t.owner_name !== t.name ? `<div class="towner">${escapeHtml(t.owner_name)}</div>` : ""}
            <div class="tuser">T${escapeHtml(t.slot)} · ${picks.length} pick${picks.length === 1 ? "" : "s"}${rookieCount ? ` · ${rookieCount}R` : ""}${veteranCount ? ` · ${veteranCount}V` : ""}</div>
          </div>
        </div>
        <div class="poslist">${rows}</div>
      </div>`;
    });
    teamgrid.innerHTML = html;
  }

  const withState = (fn) => (...args) => {
    syncState();
    return fn(...args);
  };
  gridbtn.onclick = withState(() => setViewMode("grid"));
  teamsbtn.onclick = withState(() => setViewMode("teams"));
  syncState();
  setViewMode("grid");

  return {
    addToTicker: withState(addToTicker),
    applyTeamsOrder: withState(applyTeamsOrder),
    gridCellFlags,
    headerCellHtml,
    invalidateBoardViews,
    pickNoForRoundSlot,
    renderGrid: withState(renderGrid),
    renderTeamView: withState(renderTeamView),
    seedTicker: withState(seedTicker),
    setViewMode: withState(setViewMode),
    showRestingView: withState(showRestingView)
  };
}
