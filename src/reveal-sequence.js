export function createRevealSequence({
  POS_HEX,
  avatarHtml,
  broadcastSettings,
  burstReveal,
  card,
  draftedby,
  escapeHtml,
  getState,
  getMotionState,
  gridview,
  hexToRgba,
  logopattern,
  pickribbon,
  positionBadge,
  preloadHeadshot,
  preloadTeamLogo,
  primePickAssets,
  resetRevealBurst,
  showRecap,
  showRestingView,
  skiphint,
  soundOnClock,
  soundPickIncoming,
  soundPickReveal,
  spotlight,
  spotlightImageHtml,
  startRevealPerformanceMonitor,
  synergyForPick,
  teamBuildForPick,
  teamLogoUrl,
  teamTheme,
  teamview,
  transitionveil
}) {
  let allPicks = [];
  let teamsOrder = [];
  let currentTeams = 12;
  let currentRounds = null;
  let draftStatus = null;
  let latestClock = null;
  let revealQueue = [];
  let revealing = false;
  let revealStage = null;
  let revealTimer = null;
  let pendingRecapPicks = null;
  let revealToken = 0;
  let orderRevealTimers = [];
  let currentRevealPick = null;
  const PICK_CALL_DURATION = 850;
  const FAST_PICK_CALL_DURATION = 260;
  const CARD_DURATION = 4250;
  const FAST_CARD_DURATION = 1150;
  const MAX_REVEAL_BACKLOG = 5;

  function syncState() {
    ({ allPicks, teamsOrder, currentTeams, currentRounds, draftStatus, latestClock } = getState());
  }

  // ==================================================
  // DRAFT ORDER REVEAL (pre-draft filler, plays once)
  // ==================================================
  let draftOrderRevealed = false;
  function maybeRunDraftOrderReveal() {
    if (draftOrderRevealed) return;
    if (allPicks.length > 0 || !teamsOrder.length || revealing) return;
    if (!["drafting", "paused"].includes(draftStatus)) return;
    draftOrderRevealed = true;

    showSpotlight();
    spotlight.classList.remove("sweep");
    const perChip = 150;
    let html = `<div id="orderreveal"><div class="orlabel">Draft Order</div><div class="orlist">`;
    teamsOrder.forEach((t, i) => {
      const ownerName = t.owner_name || t.name;
      html += `<div class="orchip" style="animation-delay:${((i * perChip) / 1000).toFixed(2)}s">
        <span class="orpick">${i + 1}</span>
        <div class="avatar">${avatarHtml(t.avatar, ownerName)}</div>
        <span class="orname">${escapeHtml(t.name || ownerName)}</span>
      </div>`;
    });
    html += `</div></div>`;
    card.innerHTML = html;

    clearOrderRevealTimers();
    teamsOrder.forEach((_, i) => {
      orderRevealTimers.push(setTimeout(soundOnClock, 200 + i * perChip));
    });

    const totalTime = 200 + teamsOrder.length * perChip + 2400;
    orderRevealTimers.push(setTimeout(() => { if (!revealing) showRestingView(); }, totalTime));
  }

  function queueReveal(pick) {
    clearOrderRevealTimers();
    revealQueue.push(pick);
    if (broadcastSettings.mockDraftMode && revealQueue.length > MAX_REVEAL_BACKLOG) {
      revealQueue = revealQueue.slice(-MAX_REVEAL_BACKLOG);
    }
    if (!revealing) processRevealQueue();
  }

  function processRevealQueue() {
    clearRevealTimer();
    if (revealQueue.length === 0) {
      revealing = false;
      revealStage = null;
      currentRevealPick = null;
      skiphint.classList.remove("show");
      resetRevealMotion();
      showRestingView();
      if (pendingRecapPicks) {
        const picks = pendingRecapPicks;
        pendingRecapPicks = null;
        showRecap(picks);
        return;
      }
      return;
    }
    resetRevealMotion();
    revealing = true;
    const pick = revealQueue.shift();
    currentRevealPick = pick;
    const token = ++revealToken;
    runPickCallStage(pick, revealQueue.length, token);
  }

  function isMockCatchUp(backlog) {
    return broadcastSettings.mockDraftMode && backlog > 1;
  }

  function applyRevealTheme(pick) {
    const pos = (pick?.player?.position || "").toUpperCase();
    const posHex = POS_HEX[pos] || "#ffcc33";
    const theme = teamTheme(pick?.player?.team);
    spotlight.style.setProperty("--pos-color", posHex);
    spotlight.style.setProperty("--pos-glow", hexToRgba(posHex, 0.32));
    spotlight.style.setProperty("--team-primary", theme.primary);
    spotlight.style.setProperty("--team-secondary", theme.secondary);
    spotlight.style.setProperty("--team-primary-text", theme.primaryText);
    spotlight.style.setProperty("--team-secondary-text", theme.secondaryText);
    spotlight.style.setProperty("--team-secondary-ink", theme.secondaryInk);
    spotlight.style.setProperty("--team-glow", theme.glow);
    spotlight.style.setProperty("--team-soft", theme.soft);
    spotlight.classList.remove("motion-a", "motion-b", "motion-c");
    spotlight.classList.add(["motion-a", "motion-b", "motion-c"][Number(pick?.pick_no || 0) % 3]);
    return theme;
  }

  function runPickCallStage(pick, backlog, token) {
    if (getMotionState().effective === "reduced") {
      runCardStage(pick, backlog, token);
      return;
    }
    revealStage = "signal";
    const catchUp = isMockCatchUp(backlog);
    spotlight.classList.toggle("catch-up", catchUp);
    skiphint.classList.add("show");
    showSpotlight();
    primePickAssets([pick]);
    applyRevealTheme(pick);
    pickribbon.classList.remove("reveal");
    draftedby.classList.remove("reveal");
    draftedby.innerHTML = "";
    logopattern.classList.remove("reveal");
    const teamName = pick.team_name || pick.team_owner || `Team ${pick.draft_slot || ""}`;
    const ownerName = pick.team_owner || pick.team_username || teamName;
    card.innerHTML = `<div id="pickcall">
      <div class="pickcall-eyebrow">Round ${escapeHtml(pick.round)} &middot; Pick ${escapeHtml(pick.pick_no)}</div>
      <div class="pickcall-title">The Pick Is In</div>
      <div class="pickcall-team">
        <div class="avatar">${avatarHtml(pick.team_avatar, ownerName)}</div>
        <div><div class="pickcall-team-name">${escapeHtml(teamName)}</div></div>
      </div>
    </div>`;
    soundPickIncoming(pick);
    revealTimer = setTimeout(() => {
      if (token === revealToken) beginPlayerTransition(pick, backlog, token);
    }, catchUp ? FAST_PICK_CALL_DURATION : PICK_CALL_DURATION);
  }

  function beginPlayerTransition(pick, backlog, token) {
    const catchUp = isMockCatchUp(backlog);
    revealStage = "transition";
    const pickCall = document.getElementById("pickcall");
    if (pickCall) pickCall.classList.add("handoff");
    transitionveil.classList.remove("active");
    void transitionveil.offsetWidth;
    transitionveil.classList.add("active");
    revealTimer = setTimeout(() => {
      if (token === revealToken) runCardStage(pick, backlog, token);
    }, catchUp ? 90 : 285);
  }

  function runCardStage(pick, backlog = 0, token = revealToken) {
    revealStage = "card";
    const catchUp = isMockCatchUp(backlog);
    spotlight.classList.toggle("catch-up", catchUp);
    skiphint.classList.add("show");
    showSpotlight();
    renderSpotlight(pick, true);
    soundPickReveal(pick);
    const duration = catchUp ? FAST_CARD_DURATION : CARD_DURATION;
    revealTimer = setTimeout(() => {
      if (token === revealToken) processRevealQueue();
    }, duration);
  }

  function skipReveal() {
    if (!revealing) return;
    ++revealToken;
    clearRevealTimer();
    processRevealQueue();
  }

  function clearRevealTimer() {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = null;
  }

  function clearOrderRevealTimers() {
    orderRevealTimers.forEach(clearTimeout);
    orderRevealTimers = [];
  }

  function resetRevealMotion() {
    spotlight.classList.remove("sweep");
    spotlight.classList.remove("catch-up");
    logopattern.classList.remove("reveal");
    pickribbon.classList.remove("reveal");
    draftedby.classList.remove("reveal");
    transitionveil.classList.remove("active");
    resetRevealBurst();
  }

  function renderLogoPattern(team, animate) {
    const cached = preloadTeamLogo(team);
    const logo = cached?.src || teamLogoUrl(team);
    logopattern.classList.remove("reveal");
    if (!logo) {
      logopattern.style.removeProperty("--team-logo-layer");
      logopattern.dataset.team = "";
      return;
    }
    if (logopattern.dataset.team === (team || "").toUpperCase()) {
      requestAnimationFrame(() => logopattern.classList.add("reveal"));
      return;
    }
    logopattern.style.setProperty("--team-logo-layer", `url("${logo}")`);
    logopattern.dataset.team = (team || "").toUpperCase();
    requestAnimationFrame(() => logopattern.classList.add("reveal"));
  }

  function splitPlayerName(name) {
    const parts = String(name || "Unknown Player").trim().split(/\s+/);
    if (parts.length === 1) return { first: "", last: parts[0] };
    return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
  }

  function slotForPickNo(pickNo, teams) {
    const round = Math.ceil(pickNo / teams);
    const posInRound = ((pickNo - 1) % teams) + 1;
    return { round, slot: round % 2 === 1 ? posInRound : teams - posInRound + 1 };
  }

  function upcomingAfterPick(pick, count = 4) {
    const teams = Number(currentTeams || latestClock?.teams || teamsOrder.length || 12);
    const rounds = Number(currentRounds || latestClock?.rounds || 0);
    const totalPicks = rounds ? rounds * teams : null;
    const rows = [];
    const firstNextPick = Number(pick?.pick_no || allPicks.length || 0) + 1;
    if (!teams || firstNextPick <= 1) return rows;
    for (let pickNo = firstNextPick; rows.length < count; pickNo++) {
      if (totalPicks && pickNo > totalPicks) break;
      const s = slotForPickNo(pickNo, teams);
      const team = teamsOrder.find((t) => Number(t.slot) === Number(s.slot));
      rows.push({
        pick_no: pickNo,
        slot: s.slot,
        owner: team?.name || team?.owner_name || `Team ${s.slot}`
      });
    }
    return rows;
  }

  function playerDossierMarkup(pick, cls = "") {
    const player = pick.player || {};
    const facts = [];
    if (typeof pick.adp === "number") facts.push({ label: "Market", value: `ADP #${Math.round(pick.adp)}`, tone: "market" });
    if (typeof player.age === "number") facts.push({ label: "Age", value: String(player.age) });
    if (typeof player.years_exp === "number") facts.push({ label: "Experience", value: player.years_exp === 0 ? "Rookie" : `${player.years_exp} yr${player.years_exp === 1 ? "" : "s"}` });
    if (typeof player.depth_chart_order === "number" && player.depth_chart_order > 0) facts.push({ label: "Depth chart", value: `${player.position || ""}${player.depth_chart_order}` });
    if (player.injury_status) facts.push({ label: "Status", value: player.injury_status, tone: "alert" });
    else if (player.number != null && player.number !== "") facts.push({ label: "Jersey", value: `#${player.number}` });
    return facts.slice(0, 4).length ? `<div id="player-dossier">${facts.slice(0, 4).map((fact) => `<div class="dossier-fact ${fact.tone || ""}${cls}"><div class="dossier-label">${escapeHtml(fact.label)}</div><div class="dossier-value">${escapeHtml(fact.value)}</div></div>`).join("")}</div>` : "";
  }

  function renderSpotlight(pick, animate) {
    primePickAssets([pick]);
    const cls = animate ? " reveal" : "";
    const pos = (pick.player.position || "").toUpperCase();
    const posHex = POS_HEX[pos] || "#ffcc33";
    const theme = teamTheme(pick.player.team);
    spotlight.style.setProperty("--pos-color", posHex);
    spotlight.style.setProperty("--pos-glow", hexToRgba(posHex, 0.32));
    spotlight.style.setProperty("--team-primary", theme.primary);
    spotlight.style.setProperty("--team-secondary", theme.secondary);
    spotlight.style.setProperty("--team-primary-text", theme.primaryText);
    spotlight.style.setProperty("--team-secondary-text", theme.secondaryText);
    spotlight.style.setProperty("--team-secondary-ink", theme.secondaryInk);
    spotlight.style.setProperty("--team-glow", theme.glow);
    spotlight.style.setProperty("--team-soft", theme.soft);
    renderLogoPattern(pick.player.team, animate);

    const nm = splitPlayerName(pick.player.name);
    const logo = preloadTeamLogo(pick.player.team)?.src || teamLogoUrl(pick.player.team);
    const synergy = synergyForPick(pick);
    const cards = [];
    if (pick.player.is_rookie) cards.push(`<div class="player-stat-card rookie-card${cls}"><div class="rookie-mark">R</div><div><div class="stat-label">First Year</div><div class="stat-value">Rookie</div></div></div>`);
    else if (pick.player.is_veteran) cards.push(`<div class="player-stat-card veteran-card${cls}"><div class="veteran-mark">V</div><div><div class="stat-label">NFL Experience</div><div class="stat-value">Veteran</div></div></div>`);

    pickribbon.classList.remove("reveal");
    pickribbon.innerHTML = `ROUND ${pick.round} &nbsp;•&nbsp; PICK ${pick.pick_no}`;
    card.innerHTML = `
      <div id="playerinfo">
        <div id="playername" class="${cls}"><span class="name-first">${escapeHtml(nm.first)}</span><span class="name-last">${escapeHtml(nm.last)}</span></div>
        <div id="player-divider" class="${cls}"></div>
        <div id="meta" class="${cls}">
          ${positionBadge(pick.player.position)}
          ${logo ? `<img id="nfl-logo-small" src="${logo}" alt="" decoding="async">` : ""}
          <span id="nflteam">${escapeHtml(pick.player.team || "FA")}</span>
        </div>
        ${cards.length ? `<div id="playercards">${cards.join("")}</div>` : ""}
        ${playerDossierMarkup(pick, cls)}
        ${pick.player.is_rookie && pick.player.college ? `<div id="college-line" class="${cls}"><span class="college-icon">U</span><span><span class="college-label">College</span><span class="college-name">${escapeHtml(pick.player.college)}</span></span></div>` : ""}
        ${synergy ? `<div id="synergy-callout" class="${cls}"><div class="syn-label">${escapeHtml(synergy.label)}</div><div class="syn-main">${escapeHtml(synergy.main)}</div><div class="syn-sub">${escapeHtml(synergy.sub)}</div></div>` : ""}
      </div>
      <div id="herowrap"><div id="photostage">
        <div id="beams" class="${cls}"></div><div id="orbit1" class="orbit${cls}"></div><div id="orbit2" class="orbit${cls}"></div><div id="orbit3" class="orbit${cls}"></div><div id="orbitdots" class="${cls}"></div><div id="pulsering" class="${cls}"></div>
        <div id="headshot" class="${cls}">${spotlightImageHtml(pick)}</div>
      </div></div>`;

    const draftedTeamName = pick.team_name || pick.team_owner || `Team ${pick.draft_slot || ""}`;
    const ownerName = pick.team_owner || pick.team_username || draftedTeamName;
    const buildHtml = broadcastSettings.showTeamBuild ? teamBuildForPick(pick) : "";
    draftedby.classList.remove("reveal");
    draftedby.innerHTML = `
      <div class="selection-heading"><div class="avatar">${avatarHtml(pick.team_avatar, ownerName)}</div><div class="selection-team">${escapeHtml(draftedTeamName)}</div></div>
      <div class="selection-pick">Round ${escapeHtml(pick.round)} &middot; Pick ${escapeHtml(pick.pick_no)}</div>
      ${buildHtml}`;

    if (animate) {
      void pickribbon.offsetWidth;
      pickribbon.classList.add("reveal");
      draftedby.classList.add("reveal");
      burstReveal(theme.primary);
      spotlight.classList.add("sweep");
    }
  }

  function showSpotlight() {
    spotlight.classList.remove("dormant");
    spotlight.classList.add("active");
    startRevealPerformanceMonitor();
    gridview.classList.remove("active");
    teamview.classList.remove("active");
  }

  const withState = (fn) => (...args) => {
    syncState();
    return fn(...args);
  };

  return {
    deferRecap: (picks) => { pendingRecapPicks = picks; },
    isPending: () => revealing || revealQueue.length > 0,
    isRevealing: () => revealing,
    maybeRunDraftOrderReveal: withState(maybeRunDraftOrderReveal),
    queueReveal: withState(queueReveal),
    recoveryPicks: (picks) => broadcastSettings.mockDraftMode ? picks.slice(-MAX_REVEAL_BACKLOG) : picks,
    renderSpotlight: withState(renderSpotlight),
    resetRevealMotion,
    showSpotlight,
    skipReveal: withState(skipReveal),
    trimBacklog: () => {
      if (revealQueue.length > MAX_REVEAL_BACKLOG) revealQueue = revealQueue.slice(-MAX_REVEAL_BACKLOG);
    }
  };
}
