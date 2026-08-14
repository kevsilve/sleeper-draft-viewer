
import {
  configureDraft,
  detectDraftsForUsername,
  forceDraftResync,
  requestDraftSnapshot,
  startDraftEngine,
  subscribeToDraftEvents,
  validateDraft
} from "./draft-engine.js";
import { registerSW } from "virtual:pwa-register";
import {
  POS_COLORS,
  POS_HEX,
  POS_ORDER,
  hexToRgba,
  preloadHeadshot,
  preloadTeamLogo,
  primePickAssets,
  teamLogoUrl,
  teamTheme
} from "./presentation-assets.js";
import {
  setupscreen,
  usernameInput,
  detectBtn,
  draftlist,
  draftIdInput,
  connectBtn,
  setupErr,
  appEl,
  spotlight,
  gridview,
  teamview,
  teamgrid,
  grid,
  card,
  pickribbon,
  draftedby,
  logopattern,
  skiphint,
  onclockname,
  onclockowner,
  onclockavatar,
  pickcounter,
  roundcounter,
  timertext,
  timerfg,
  timerwrap,
  reconnectbanner,
  ticker,
  soundbtn,
  fsbtn,
  gridbtn,
  teamsbtn,
  zoombtn,
  settingsbtn,
  changebtn,
  settingspanel,
  settingsclose,
  mockModeToggle,
  teamBuildToggle,
  settingsSoundToggle,
  replayRevealBtn,
  modeStatusText,
  performanceStatusText,
  performanceReadout,
  transitionveil,
  controls,
  tradebanner,
  completeOverlay,
  recapgrid,
  recapawards,
  recapTeamsBtn,
  recapLineupsBtn,
  recapBoardBtn,
  recapZoomBtn
} from "./ui-elements.js";
import { escapeHtml, extractDraftId, fmtDraftDate } from "./draft-input.js";
import { createSoundEffects } from "./sound-effects.js";
import { createRevealEffects } from "./reveal-effects.js";
import { bindSetupController } from "./setup-controller.js";
import { createSettingsController } from "./settings-controller.js";
import { bindGlobalControls } from "./controls.js";
import { createBoardViews } from "./board-views.js";
import { createRecap } from "./recap.js";
import { createRevealSequence } from "./reveal-sequence.js";
/** @typedef {import("./draft-types.js").DraftEvent} DraftEvent */
/** @typedef {import("./draft-types.js").DraftPick} DraftPick */
const RADIUS = 28;
const CIRC = 2 * Math.PI * RADIUS;
timerfg.style.strokeDasharray = CIRC;

let allPicks = [];
let revealController;
let teamsOrder = [];
let currentTeams = 12;
let currentRounds = null;
let draftStatus = null;
let adpAvailable = false;
let leagueContext = { roster_positions: [], scoring_settings: {}, draft_settings: {}, scoring_type: null };
let clockRenderKey = "";
let timerRenderKey = "";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const lowPowerMode = reduceMotion || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
document.body.classList.toggle("low-power", lowPowerMode);
let performanceRaf = 0;
let performanceLastFrame = 0;
let performanceSamples = [];

const {
  render: renderBroadcastSettings,
  save: saveBroadcastSettings,
  settings: broadcastSettings,
  togglePanel: toggleSettingsPanel
} = createSettingsController({
  getPickCount: () => allPicks.length,
  modeStatusText,
  mockModeToggle,
  onMockModeEnabled: () => {
    revealController.trimBacklog();
  },
  onReplayLatest: () => {
    const latestPick = allPicks[allPicks.length - 1];
    if (latestPick) queueReveal(latestPick);
  },
  onSoundChange: (enabled) => setSoundEnabled(enabled),
  replayRevealBtn,
  settingsbtn,
  settingsclose,
  settingspanel,
  settingsSoundToggle,
  teamBuildToggle
});

function monitorRevealPerformance(timestamp) {
  if (!spotlight.classList.contains("active")) {
    performanceRaf = 0;
    performanceLastFrame = 0;
    performanceSamples = [];
    return;
  }
  if (performanceLastFrame) {
    const delta = timestamp - performanceLastFrame;
    if (delta > 0 && delta < 120) performanceSamples.push(delta);
  }
  performanceLastFrame = timestamp;
  if (performanceSamples.length >= 45) {
    const recent = performanceSamples.slice(-90);
    const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const fps = Math.round(1000 / average);
    const healthy = fps >= 52;
    performanceStatusText.textContent = healthy ? `Render health · smooth at ${fps} FPS` : `Render health · under load at ${fps} FPS`;
    performanceReadout.classList.toggle("good", healthy);
    performanceReadout.classList.toggle("warn", !healthy);
    if (performanceSamples.length > 90) performanceSamples = recent;
  }
  performanceRaf = requestAnimationFrame(monitorRevealPerformance);
}

function startRevealPerformanceMonitor() {
  if (performanceRaf) return;
  performanceLastFrame = 0;
  performanceSamples = [];
  performanceRaf = requestAnimationFrame(monitorRevealPerformance);
}

document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("app-suspended", document.hidden);
  if (!document.hidden) forceDraftResync();
});

// ==================================================
// SETUP / DRAFT SELECTION
// ==================================================
bindSetupController({
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
});

async function checkStatus() {
  const params = new URLSearchParams(location.search);
  let draftId = params.get("draft");
  if (!draftId) {
    try { draftId = localStorage.getItem("draft-viewer-last-draft"); } catch {}
  }

  try {
    const savedUsername = localStorage.getItem("draft-viewer-last-username");
    if (savedUsername && !usernameInput.value) usernameInput.value = savedUsername;
  } catch {}

  if (!draftId) {
    setupscreen.classList.add("show");
    return;
  }

  try {
    await configureDraft(draftId);
    startDraftEngine();
    appEl.classList.add("ready");
    setupscreen.classList.remove("show");
    connect();
  } catch (err) {
    setupErr.textContent = err.message || "Could not load that draft.";
    setupscreen.classList.add("show");
  }
}

// ==================================================
// SOUND
// ==================================================
let muted = !broadcastSettings.soundEnabled;
const {
  setEnabled: setAudioEnabled,
  soundClockWarn,
  soundOnClock,
  soundPickIncoming,
  soundPickReveal,
  soundTrade
} = createSoundEffects(broadcastSettings.soundEnabled);
function setSoundEnabled(enabled) {
  broadcastSettings.soundEnabled = !!enabled;
  muted = !broadcastSettings.soundEnabled;
  soundbtn.textContent = muted ? "🔇" : "🔊";
  setAudioEnabled(broadcastSettings.soundEnabled);
  saveBroadcastSettings();
  renderBroadcastSettings();
}
soundbtn.onclick = () => setSoundEnabled(muted);

// ==================================================
// CONFETTI
// ==================================================
const canvas = document.getElementById("confetti-canvas");
const { burstReveal, resetRevealBurst } = createRevealEffects({ canvas, lowPowerMode, reduceMotion });

// ==================================================
// TIMER
// ==================================================
let deadline = null;
let pickTimerSeconds = 0;
let lastClockPickNo = null;
let warnPlayedForPick = null;
let latestClock = null;
function tickTimer() {
  if (!deadline || pickTimerSeconds <= 0) {
    if (timerRenderKey !== "idle") {
      timertext.textContent = "--";
      timerfg.style.strokeDashoffset = CIRC;
      timerwrap.classList.remove("warn", "critical");
      document.body.classList.remove("clock-critical");
      timerRenderKey = "idle";
    }
    return;
  }
  const remaining = Math.max(0, deadline - Date.now());
  const secs = Math.ceil(remaining / 1000);
  const state = secs <= 10 ? "critical" : secs <= 30 ? "warn" : "normal";
  const criticalEdge = secs <= 5;
  const nextTimerKey = `${secs}|${state}|${criticalEdge}`;
  if (nextTimerKey === timerRenderKey) return;
  timerRenderKey = nextTimerKey;

  timertext.textContent = secs;
  const frac = Math.max(0, Math.min(1, remaining / (pickTimerSeconds * 1000)));
  timerfg.style.strokeDashoffset = CIRC * (1 - frac);

  // Three-stage color ramp: plenty of time -> getting close -> urgent.
  // The last few seconds also get a pulse so it reads from across the room.
  if (state === "critical") {
    timerfg.style.stroke = "#e74c3c";
    timerwrap.classList.add("critical");
    timerwrap.classList.remove("warn");
    document.body.classList.toggle("clock-critical", criticalEdge);
    if (secs <= 5 && warnPlayedForPick !== lastClockPickNo) {
      warnPlayedForPick = lastClockPickNo;
      soundClockWarn();
    }
  } else if (state === "warn") {
    timerfg.style.stroke = "#e0a72e";
    timerwrap.classList.add("warn");
    timerwrap.classList.remove("critical");
    document.body.classList.remove("clock-critical");
  } else {
    timerfg.style.stroke = "var(--accent)";
    timerwrap.classList.remove("warn", "critical");
    document.body.classList.remove("clock-critical");
  }
}
setInterval(tickTimer, 200);

function avatarHtml(avatarId, name) {
  const initials = (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  if (avatarId) {
    return `<img src="https://sleepercdn.com/avatars/thumbs/${avatarId}" onerror="this.parentElement.textContent='${initials}'" />`;
  }
  return initials;
}

function spotlightImageHtml(pick) {
  const pos = (pick?.player?.position || "").toUpperCase();
  const team = pick?.player?.team || "";
  if (pos === "DEF" && team && team.toUpperCase() !== "FA") {
    const cachedLogo = preloadTeamLogo(team);
    const logoUrl = cachedLogo?.src || teamLogoUrl(team);
    return `<img class="def-logo" src="${logoUrl}" alt="" decoding="async" onerror="this.parentElement.textContent='${escapeHtml(team)}'" />`;
  }

  const playerId = pick?.player?.id;
  if (!playerId) return "NFL";
  const cached = preloadHeadshot(playerId);
  return `<img src="${cached?.src || playerHeadshotUrl(playerId)}" alt="" decoding="async" onerror="this.parentElement.textContent='NFL'" />`;
}

function positionBadge(pos) {
  const p = (pos || "").toUpperCase();
  return `<span class="badge ${p}">${p || "?"}</span>`;
}

// ==================================================
// CLOCK
// ==================================================
function renderClock(clock) {
  latestClock = clock;
  draftStatus = clock.draft_status || draftStatus;
  const clockTeamName = clock.on_clock || "-";
  const clockOwnerName = clock.on_clock_owner || clock.on_clock || "-";
  const totalPicks = clock.rounds ? clock.teams * clock.rounds : "?";
  const nextClockRenderKey = [
    clockTeamName,
    clockOwnerName,
    clock.on_clock_avatar || "",
    clock.pick_no,
    totalPicks,
    clock.round,
    clock.teams,
    clock.rounds
  ].join("|");
  if (nextClockRenderKey !== clockRenderKey) {
    clockRenderKey = nextClockRenderKey;
    onclockname.textContent = clockTeamName;
    onclockowner.textContent = clockOwnerName !== clockTeamName ? clockOwnerName : "";
    onclockavatar.innerHTML = avatarHtml(clock.on_clock_avatar, clockOwnerName);
    pickcounter.textContent = `Pick ${clock.pick_no} of ${totalPicks}`;
    roundcounter.textContent = `Round ${clock.round}`;
  }
  currentTeams = clock.teams;
  currentRounds = clock.rounds;
  deadline = clock.deadline;
  pickTimerSeconds = clock.pick_timer || 0;
  if (lastClockPickNo !== null && clock.pick_no !== lastClockPickNo) {
    soundOnClock(clock);
    warnPlayedForPick = null;
    const onclockEl = document.getElementById("onclock");
    onclockEl.classList.remove("clock-change");
    void onclockEl.offsetWidth;
    onclockEl.classList.add("clock-change");
    setTimeout(() => onclockEl.classList.remove("clock-change"), 700);
  }
  lastClockPickNo = clock.pick_no;
  tickTimer();
  renderGrid();
  renderTeamView();
  maybeRunDraftOrderReveal();
}

// ==================================================
// REVEAL SEQUENCE: flash -> cinematic card -> hold -> next
// Skippable with ArrowRight / Space.
// ==================================================
revealController = createRevealSequence({
  POS_HEX,
  avatarHtml,
  broadcastSettings,
  burstReveal,
  card,
  draftedby,
  escapeHtml,
  getState: () => ({ allPicks, teamsOrder, currentTeams, currentRounds, draftStatus, latestClock }),
  gridview,
  hexToRgba,
  logopattern,
  pickribbon,
  positionBadge,
  preloadHeadshot,
  preloadTeamLogo,
  primePickAssets,
  resetRevealBurst,
  showRecap: (picks) => showRecap(picks),
  showRestingView: () => showRestingView(),
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
});
const {
  maybeRunDraftOrderReveal,
  queueReveal,
  renderSpotlight,
  resetRevealMotion,
  showSpotlight,
  skipReveal
} = revealController;

function pickPosition(pick) {
  return (pick?.player?.position || "").toUpperCase();
}

function synergyForPick(pick, history = allPicks) {
  const nflTeam = (pick?.player?.team || "").toUpperCase();
  if (!nflTeam || nflTeam === "FA") return null;
  const sameRosterBeforePick = history.filter((p) =>
    p.pick_no < pick.pick_no &&
    Number(p.draft_slot) === Number(pick.draft_slot) &&
    (p.player.team || "").toUpperCase() === nflTeam
  );
  if (!sameRosterBeforePick.length) return null;

  const pos = pickPosition(pick);
  const stackMate = sameRosterBeforePick.find((p) => {
    const otherPos = pickPosition(p);
    return (pos === "QB" && ["WR", "TE"].includes(otherPos)) || (["WR", "TE"].includes(pos) && otherPos === "QB");
  });
  if (stackMate) {
    const qb = pos === "QB" ? pick : stackMate;
    const catcher = pos === "QB" ? stackMate : pick;
    return {
      type: "stack",
      label: "Stack Alert",
      main: `${qb.player.name} + ${catcher.player.name}`,
      sub: `${nflTeam} QB/pass-catcher stack`
    };
  }

  const handcuffMate = pos === "RB" ? sameRosterBeforePick.find((p) => pickPosition(p) === "RB") : null;
  if (handcuffMate) {
    return {
      type: "handcuff",
      label: "Handcuff Watch",
      main: `${pick.player.name} + ${handcuffMate.player.name}`,
      sub: `${nflTeam} backfield protection`
    };
  }

  if (sameRosterBeforePick.length >= 2) {
    return {
      type: "core",
      label: "Team Core",
      main: `${sameRosterBeforePick.length + 1} ${nflTeam} players`,
      sub: "Same-team core is building"
    };
  }

  const mate = sameRosterBeforePick[0];
  return {
    type: "pair",
    label: "Teammate Pair",
    main: `${pick.player.name} + ${mate.player.name}`,
    sub: `${nflTeam} teammate pair`
  };
}

function sameDraftingTeam(a, b) {
  if (a?.roster_id != null && b?.roster_id != null) return Number(a.roster_id) === Number(b.roster_id);
  return Number(a?.draft_slot) === Number(b?.draft_slot);
}

function teamBuildForPick(pick) {
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const colors = { ...POS_HEX, FLEX: "#95a5a6" };
  const teamPicks = allPicks
    .filter((row) => Number(row.pick_no) <= Number(pick.pick_no) && sameDraftingTeam(row, pick))
    .sort((a, b) => Number(a.pick_no) - Number(b.pick_no));
  const counts = Object.fromEntries(positions.map((pos) => [pos, 0]));
  teamPicks.forEach((row) => {
    const pos = pickPosition(row);
    if (pos in counts) counts[pos]++;
  });
  const total = teamPicks.length || 1;
  const ranked = positions.map((pos) => ({ pos, count: counts[pos] })).sort((a, b) => b.count - a.count);
  const leader = ranked[0];
  const used = ranked.filter((row) => row.count > 0).length;
  const untouched = positions.length - used;
  const format = leagueFormat();
  const coverage = lineupCoverage(teamPicks);
  let identity = "Build taking shape";
  if (teamPicks.length === 1) identity = `Starting at ${leader.pos}`;
  else if (used === 1) identity = `${leader.pos}-only start`;
  else if (leader.count / teamPicks.length >= 0.5) identity = `${leader.pos}-heavy build`;
  else if (["QB", "RB", "WR", "TE"].every((pos) => counts[pos] > 0)) identity = "Core positions covered";
  else identity = "Balanced build";
  if (coverage.open.length) identity = `${coverage.filled}/${coverage.total} starters filled`;
  else if (coverage.total) identity = "Starting lineup covered";

  const countHtml = positions.map((pos) => `
    <div class="comp-item${counts[pos] ? "" : " zero"}" style="--comp-color:${colors[pos]}">
      <span class="comp-pos">${pos}</span><span class="comp-count">${counts[pos]}</span>
    </div>`).join("");
  const barHtml = positions.filter((pos) => counts[pos] > 0)
    .map((pos) => `<span style="flex:${counts[pos]};background:${colors[pos]}" title="${pos}: ${counts[pos]}"></span>`).join("");
  const rookieCount = teamPicks.filter((row) => row.player.is_rookie).length;
  const veteranCount = teamPicks.filter((row) => row.player.is_veteran).length;
  const experienceHtml = rookieCount || veteranCount ? `<div class="experience-summary">
    ${rookieCount ? `<span class="experience-pill rookie">${rookieCount} Rookie${rookieCount === 1 ? "" : "s"}</span>` : ""}
    ${veteranCount ? `<span class="experience-pill veteran">${veteranCount} Veteran${veteranCount === 1 ? "" : "s"}</span>` : ""}
  </div>` : "";
  const maxVisiblePicks = 5;
  const recentPickCount = maxVisiblePicks - 1;
  const earlierPickCount = teamPicks.length > maxVisiblePicks ? teamPicks.length - recentPickCount : 0;
  const visiblePath = earlierPickCount ? teamPicks.slice(-recentPickCount) : teamPicks;
  const pathHtml = visiblePath.map((row, index) => {
    const pos = pickPosition(row) || "?";
    const isCurrent = index === visiblePath.length - 1;
    return `<span class="path-chip${isCurrent ? " current" : ""}" style="--chip-color:${colors[pos] || colors.FLEX}" title="Round ${escapeHtml(row.round)} · ${escapeHtml(row.player.name)}">${escapeHtml(pos)}</span>`;
  }).join("");
  const earlierHtml = earlierPickCount
    ? `<span class="path-chip earlier" title="${earlierPickCount} earlier pick${earlierPickCount === 1 ? "" : "s"}">+${earlierPickCount}</span>`
    : "";
  return `<div class="team-build">
    <div class="build-head"><div><div class="build-label">Team composition</div><div class="build-sub">${teamPicks.length} pick${teamPicks.length === 1 ? "" : "s"} · ${escapeHtml(format.short)}</div></div><div class="build-identity">${escapeHtml(identity)}</div></div>
    <div class="comp-grid">${countHtml}</div>
    <div class="comp-bar">${barHtml}</div>
    ${experienceHtml}
    <div class="build-path"><span class="path-label">Draft path</span>${earlierHtml}${pathHtml}</div>
  </div>`;
}

const {
  addToTicker,
  applyTeamsOrder,
  gridCellFlags,
  headerCellHtml,
  invalidateBoardViews,
  pickNoForRoundSlot,
  renderGrid,
  renderTeamView,
  seedTicker,
  setViewMode,
  showRestingView
} = createBoardViews({
  POS_COLORS,
  POS_ORDER,
  avatarHtml,
  escapeHtml,
  getState: () => ({ allPicks, teamsOrder, currentTeams, currentRounds, latestClock }),
  grid,
  gridbtn,
  gridview,
  isRevealing: () => revealController.isRevealing(),
  pickPosition,
  preloadTeamLogo,
  renderClock,
  setTeamsOrder: (nextTeamsOrder) => { teamsOrder = nextTeamsOrder; },
  spotlight,
  synergyForPick,
  teamLogoUrl,
  teamsbtn,
  teamgrid,
  teamview,
  ticker
});

// ---------- grid zoom (helps deep drafts fit / stay readable on a TV) ----------
const ZOOM_LEVELS = [1, 0.85, 0.7, 1.15];
let zoomIndex = 0;
function applyGridZoom() {
  const z = ZOOM_LEVELS[zoomIndex];
  grid.style.zoom = z;
  zoombtn.textContent = `🔍 ${Math.round(z * 100)}%`;
}
zoombtn.onclick = () => { zoomIndex = (zoomIndex + 1) % ZOOM_LEVELS.length; applyGridZoom(); };
applyGridZoom();

bindGlobalControls({
  completeOverlay,
  controls,
  draftIdInput,
  fsbtn,
  recapBoardBtn,
  recapLineupsBtn,
  recapTeamsBtn,
  recapZoomBtn,
  setViewMode,
  settingspanel,
  skipReveal,
  soundbtn,
  teamsbtn,
  toggleSettingsPanel,
  usernameInput,
  zoombtn
});

// ==================================================
// TRADE BANNER
// ==================================================
function showTrade(trade) {
  tradebanner.innerHTML = `
    <div class="tradeicon">🔄</div>
    <div class="tradetext">
      <div class="tradelabel">Pick Traded</div>
      <div class="trademain"><b>${escapeHtml(trade.from)}</b> <span class="tradearrow">→</span> <b>${escapeHtml(trade.to)}</b></div>
      <div class="tradesub">Round ${trade.round} pick</div>
    </div>
  `;
  tradebanner.classList.remove("show");
  void tradebanner.offsetWidth; // restart animation
  tradebanner.classList.add("show");
  soundTrade();
  setTimeout(() => tradebanner.classList.remove("show"), 5500);
}

const { leagueFormat, lineupCoverage, renderRecap, showRecap } = createRecap({
  POS_COLORS,
  ZOOM_LEVELS,
  burstReveal,
  canvas,
  completeOverlay,
  deferRecap: (picks) => revealController.deferRecap(picks),
  escapeHtml,
  getState: () => ({ allPicks, teamsOrder, currentTeams, currentRounds, leagueContext }),
  gridCellFlags,
  headerCellHtml,
  isRevealPending: () => revealController.isPending(),
  pickNoForRoundSlot,
  pickPosition,
  recapBoardBtn,
  recapLineupsBtn,
  recapTeamsBtn,
  recapZoomBtn,
  recapawards,
  recapgrid,
  setAllPicks: (picks) => { allPicks = picks; },
  synergyForPick
});

// ==================================================
// WEBSOCKET
// ==================================================
let ws;
let unsubscribeFromEngine = null;
let reconnectDelay = 1000;
let reconnectBannerTimer = null;
let reconnectTimer = null;
let lastServerMessageAt = 0;
let clientInitialized = false;

function reconcilePicks(picks) {
  const byPick = new Map();
  (picks || []).forEach((pick) => {
    if (pick && Number.isFinite(Number(pick.pick_no))) byPick.set(Number(pick.pick_no), pick);
  });
  return [...byPick.values()].sort((a, b) => Number(a.pick_no) - Number(b.pick_no));
}

function showFeedStatus(text, restored = false) {
  reconnectbanner.textContent = text;
  reconnectbanner.classList.toggle("restored", restored);
  reconnectbanner.classList.add("show");
}

function markFeedRestored() {
  const wasVisible = reconnectbanner.classList.contains("show");
  clearTimeout(reconnectBannerTimer);
  if (!wasVisible) {
    reconnectbanner.classList.remove("show", "restored");
    return;
  }
  showFeedStatus("Live feed restored · fully synced", true);
  reconnectBannerTimer = setTimeout(() => reconnectbanner.classList.remove("show", "restored"), 1800);
}

function connect() {
  if (unsubscribeFromEngine) unsubscribeFromEngine();
  ws = {
    readyState: WebSocket.CONNECTING,
    close() {
      if (this.readyState === WebSocket.CLOSED) return;
      this.readyState = WebSocket.CLOSED;
      if (unsubscribeFromEngine) unsubscribeFromEngine();
      unsubscribeFromEngine = null;
      this.onclose?.();
    }
  };
  lastServerMessageAt = Date.now();
  ws.onopen = () => {
    reconnectDelay = 1000;
    clearTimeout(reconnectTimer);
  };
  ws.onclose = () => {
    // Only surface the banner if it doesn't come right back — avoids flicker on brief blips.
    clearTimeout(reconnectBannerTimer);
    reconnectBannerTimer = setTimeout(() => showFeedStatus("Live feed delayed · resyncing…"), 1200);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 8000);
  };
  ws.onerror = () => {};

  ws.onmessage = (event) => {
    lastServerMessageAt = Date.now();
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }

    if (msg.type === "UNCONFIGURED") {
      appEl.classList.remove("ready");
      setupscreen.classList.add("show");
    } else if (msg.type === "RESET") {
      location.reload();
    } else if (msg.type === "INIT") {
      const knownPickNos = new Set(allPicks.map((pick) => Number(pick.pick_no)));
      const reconciled = reconcilePicks(msg.all_picks);
      const allRecoveredPicks = clientInitialized
        ? reconciled.filter((pick) => !knownPickNos.has(Number(pick.pick_no)))
        : [];
      const recoveredPicks = revealController.recoveryPicks(allRecoveredPicks);
      allPicks = reconciled;
      renderBroadcastSettings();
      teamsOrder = msg.teams_order || [];
      draftStatus = msg.draft_status || null;
      leagueContext = msg.league_context || leagueContext;
      adpAvailable = !!msg.adp_available;
      primePickAssets(allPicks);
      seedTicker(allPicks);
      if (msg.clock) renderClock(msg.clock);
      if (allPicks.length > 0) renderSpotlight(allPicks[allPicks.length - 1], false);
      showRestingView();
      maybeRunDraftOrderReveal();
      recoveredPicks.forEach(queueReveal);
      if (msg.draft_complete) showRecap(allPicks);
      clientInitialized = true;
      markFeedRestored();
    } else if (msg.type === "HISTORY") {
      leagueContext = msg.league_context || leagueContext;
      allPicks = reconcilePicks(msg.all_picks);
      primePickAssets(allPicks);
      seedTicker(allPicks);
      invalidateBoardViews();
      if (msg.clock) renderClock(msg.clock);
      if (!revealController.isRevealing()) showRestingView();
      renderBroadcastSettings();
    } else if (msg.type === "PICK") {
      const existing = allPicks.findIndex((pick) => Number(pick.pick_no) === Number(msg.data?.pick_no));
      if (existing >= 0) {
        allPicks[existing] = msg.data;
        invalidateBoardViews();
        return;
      }
      allPicks.push(msg.data);
      allPicks.sort((a, b) => Number(a.pick_no) - Number(b.pick_no));
      renderBroadcastSettings();
      primePickAssets([msg.data]);
      addToTicker(msg.data);
      queueReveal(msg.data);
    } else if (msg.type === "PICK_TAGS") {
      const updates = new Map((msg.updates || []).map((update) => [Number(update.pick_no), update.player]));
      allPicks.forEach((pick) => {
        const playerUpdate = updates.get(Number(pick.pick_no));
        if (playerUpdate) Object.assign(pick.player, playerUpdate);
      });
      invalidateBoardViews();
      seedTicker(allPicks);
      renderGrid();
      renderTeamView();
      if (completeOverlay.classList.contains("show")) renderRecap();
    } else if (msg.type === "CLOCK") {
      renderClock(msg);
    } else if (msg.type === "TEAMS") {
      applyTeamsOrder(msg.teams_order || [], msg.clock || null);
    } else if (msg.type === "SYNC") {
      // A count mismatch means an event was missed even if the socket still
      // looks open. Reconnect immediately; INIT is an authoritative snapshot.
      if (Number(msg.pick_count) !== allPicks.length && ws?.readyState === WebSocket.OPEN) {
        showFeedStatus("Catching up missed picks · resyncing…");
        ws.close(4000, "state mismatch");
      }
    } else if (msg.type === "FEED_STATUS") {
      if (msg.status === "restored") markFeedRestored();
      else showFeedStatus("Live feed delayed · retrying Sleeper…");
    } else if (msg.type === "TRADE") {
      showTrade(msg.data);
    } else if (msg.type === "COMPLETE") {
      showRecap(msg.all_picks || allPicks);
    }
  };

  unsubscribeFromEngine = subscribeToDraftEvents((message) => {
    ws?.onmessage?.({ data: JSON.stringify(message) });
  });
  ws.readyState = WebSocket.OPEN;
  ws.onopen();
  requestDraftSnapshot();
}

// Browsers can take tens of seconds to notice a half-open Wi-Fi connection.
// The server speaks every two seconds; six quiet seconds is enough to replace
// the socket and reconcile state long before the old failure window.
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN && Date.now() - lastServerMessageAt > 6500) {
    showFeedStatus("No live signal · rebuilding connection…");
    forceDraftResync();
    lastServerMessageAt = Date.now();
  }
}, 2000);

checkStatus();

if (import.meta.env.PROD) registerSW({ immediate: true });
