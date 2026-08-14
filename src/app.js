
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
const RADIUS = 28;
const CIRC = 2 * Math.PI * RADIUS;
timerfg.style.strokeDasharray = CIRC;

let allPicks = [];
let teamsOrder = [];
let currentTeams = 12;
let currentRounds = null;
let draftStatus = null;
let adpAvailable = false;
let leagueContext = { roster_positions: [], scoring_settings: {}, draft_settings: {}, scoring_type: null };
let viewMode = "grid"; // resting view when nothing is actively being revealed: 'grid' | 'teams'
let gridRenderKey = "";
let teamRenderKey = "";
let clockRenderKey = "";
let timerRenderKey = "";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const lowPowerMode = reduceMotion || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
document.body.classList.toggle("low-power", lowPowerMode);
let recapMode = "teams";
let recapZoomIndex = 0;
let recapCelebrated = false;
let performanceRaf = 0;
let performanceLastFrame = 0;
let performanceSamples = [];
let spotlightDormantTimer = null;

const BROADCAST_SETTINGS_KEY = "draft-viewer-broadcast-settings-v1";
let broadcastSettings = { mockDraftMode: false, showTeamBuild: true, soundEnabled: true };
try {
  const savedSettings = JSON.parse(localStorage.getItem(BROADCAST_SETTINGS_KEY) || "null");
  if (savedSettings && typeof savedSettings === "object") {
    for (const key of Object.keys(broadcastSettings)) {
      if (typeof savedSettings[key] === "boolean") broadcastSettings[key] = savedSettings[key];
    }
  }
} catch {}

function saveBroadcastSettings() {
  try { localStorage.setItem(BROADCAST_SETTINGS_KEY, JSON.stringify(broadcastSettings)); } catch {}
}

function renderBroadcastSettings() {
  document.body.classList.toggle("mock-mode", broadcastSettings.mockDraftMode);
  mockModeToggle.setAttribute("aria-checked", String(broadcastSettings.mockDraftMode));
  teamBuildToggle.setAttribute("aria-checked", String(broadcastSettings.showTeamBuild));
  settingsSoundToggle.setAttribute("aria-checked", String(broadcastSettings.soundEnabled));
  settingsbtn.textContent = broadcastSettings.mockDraftMode ? "⚡ Mock" : "⚙ Live";
  settingsbtn.classList.toggle("active", settingspanel.classList.contains("show"));
  replayRevealBtn.disabled = allPicks.length === 0;
  modeStatusText.textContent = broadcastSettings.mockDraftMode
    ? "Mock mode · rapid-pick catch-up enabled"
    : "Full broadcast timing · every reveal plays";
}

function toggleSettingsPanel(show = !settingspanel.classList.contains("show")) {
  settingspanel.classList.toggle("show", show);
  settingspanel.setAttribute("aria-hidden", String(!show));
  renderBroadcastSettings();
}

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

    // Group by kind so a busy list of league drafts can never crowd mock drafts
    // out of view — each kind gets its own section instead of one flat, capped list.
    const groups = { league: [], practice: [], mock: [] };
    data.drafts.forEach((d) => { (groups[d.kind] || groups.mock).push(d); });

    const PER_SECTION = 8;
    ["league", "practice", "mock"].forEach((kind) => {
      const items = groups[kind];
      if (!items.length) return;

      const heading = document.createElement("div");
      heading.className = "draftsection";
      heading.textContent = `${sectionLabel[kind]} (${items.length})`;
      draftlist.appendChild(heading);

      items.slice(0, PER_SECTION).forEach((d) => {
        const el = document.createElement("div");
        el.className = "draftcard";
        const title = d.league_name || d.metadata_name || kindLabel[d.kind] || "Draft";
        const kind2 = kindLabel[d.kind] || "Draft";
        el.innerHTML = `
          <div>
            <div class="dname">${escapeHtml(title)} <span class="dkind ${d.kind}">${kind2}</span></div>
            <div class="dmeta">${d.teams || "?"} teams · ${d.rounds || "?"} rounds · ${escapeHtml(fmtDraftDate(d.start_time || d.created))} · ${escapeHtml(d.draft_id)}</div>
          </div>
          <div class="dstatus ${d.status}">${d.status.replace("_", " ")}</div>
        `;
        el.onclick = () => connectDraft(d.draft_id);
        draftlist.appendChild(el);
      });

      if (items.length > PER_SECTION) {
        const more = document.createElement("div");
        more.className = "setupmsg";
        more.style.margin = "2px 0 6px";
        more.textContent = `+ ${items.length - PER_SECTION} more ${sectionLabel[kind].toLowerCase()} not shown`;
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

detectBtn.onclick = runDetect;
usernameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runDetect(); });
connectBtn.onclick = () => {
  const raw = draftIdInput.value.trim();
  if (raw) connectDraft(extractDraftId(raw));
};
draftIdInput.addEventListener("keydown", (e) => { if (e.key === "Enter") connectBtn.click(); });

// Accepts a bare draft ID or a full Sleeper URL (app deep link, web draft room,
// or mock-draft share link) and pulls the numeric draft ID out of it. Sleeper's
// public API has no reliable way to list a user's standalone/practice mock
// drafts, so pasting the mock's own share link is the dependable way to load one.
changebtn.onclick = () => { setupscreen.classList.add("show"); };

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

settingsbtn.onclick = (event) => { event.stopPropagation(); toggleSettingsPanel(); };
settingsclose.onclick = () => toggleSettingsPanel(false);
settingspanel.onclick = (event) => event.stopPropagation();
document.addEventListener("click", () => toggleSettingsPanel(false));
mockModeToggle.onclick = () => {
  broadcastSettings.mockDraftMode = !broadcastSettings.mockDraftMode;
  if (broadcastSettings.mockDraftMode && typeof revealQueue !== "undefined" && revealQueue.length > MAX_REVEAL_BACKLOG) {
    revealQueue = revealQueue.slice(-MAX_REVEAL_BACKLOG);
  }
  saveBroadcastSettings();
  renderBroadcastSettings();
};
teamBuildToggle.onclick = () => {
  broadcastSettings.showTeamBuild = !broadcastSettings.showTeamBuild;
  saveBroadcastSettings();
  renderBroadcastSettings();
};
settingsSoundToggle.onclick = () => setSoundEnabled(!broadcastSettings.soundEnabled);
replayRevealBtn.onclick = () => {
  const latestPick = allPicks[allPicks.length - 1];
  if (!latestPick) return;
  toggleSettingsPanel(false);
  queueReveal(latestPick);
};
renderBroadcastSettings();
// ==================================================
// FULLSCREEN / KIOSK
// ==================================================
fsbtn.onclick = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
};

let inactivityTimer;
function resetInactivity() {
  controls.classList.remove("hidden");
  document.body.classList.remove("kiosk");
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    if (document.fullscreenElement) {
      controls.classList.add("hidden");
      document.body.classList.add("kiosk");
    }
  }, 5000);
}
document.addEventListener("mousemove", resetInactivity);
resetInactivity();

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
let revealQueue = [];
let revealing = false;
let revealStage = null; // 'flash' | 'card' | null
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
  clearTimeout(spotlightDormantTimer);
  spotlight.classList.remove("dormant");
  spotlight.classList.add("active");
  startRevealPerformanceMonitor();
  gridview.classList.remove("active");
  teamview.classList.remove("active");
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
  if (!revealing) showRestingView();
}
gridbtn.onclick = () => setViewMode("grid");
teamsbtn.onclick = () => setViewMode("teams");
setViewMode("grid");

function applyTeamsOrder(nextTeamsOrder, nextClock) {
  teamsOrder = nextTeamsOrder || teamsOrder;
  invalidateBoardViews();
  if (nextClock) {
    renderClock(nextClock);
  } else {
    renderGrid();
    renderTeamView();
  }
}

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

recapTeamsBtn.onclick = () => {
  recapMode = "teams";
  renderRecap();
};
recapLineupsBtn.onclick = () => {
  recapMode = "lineups";
  renderRecap();
};
recapBoardBtn.onclick = () => {
  recapMode = "board";
  renderRecap();
};
recapZoomBtn.onclick = () => {
  recapZoomIndex = (recapZoomIndex + 1) % ZOOM_LEVELS.length;
  recapZoomBtn.textContent = `Zoom ${Math.round(ZOOM_LEVELS[recapZoomIndex] * 100)}%`;
  renderRecap();
};

// ---------- keyboard shortcuts ----------
document.addEventListener("keydown", (e) => {
  if (e.target === usernameInput || e.target === draftIdInput) return;
  if (e.key === "Escape" && settingspanel.classList.contains("show")) {
    toggleSettingsPanel(false);
  } else if (e.key === "ArrowRight" || e.code === "Space") {
    e.preventDefault();
    skipReveal();
  } else if (e.key.toLowerCase() === "g") {
    if (completeOverlay.classList.contains("show")) recapBoardBtn.click();
    else setViewMode("grid");
  } else if (e.key.toLowerCase() === "t") {
    if (completeOverlay.classList.contains("show")) recapTeamsBtn.click();
    else setViewMode("teams");
  } else if (e.key.toLowerCase() === "l") {
    if (completeOverlay.classList.contains("show")) recapLineupsBtn.click();
  } else if (e.key.toLowerCase() === "z") {
    if (completeOverlay.classList.contains("show")) recapZoomBtn.click();
    else zoombtn.click();
  } else if (e.key.toLowerCase() === "f") {
    fsbtn.click();
  } else if (e.key.toLowerCase() === "m") {
    soundbtn.click();
  }
});

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

// ==================================================
// RECAP
// ==================================================
function adpScoreForPick(pick) {
  return typeof pick.adp_diff === "number" ? -pick.adp_diff : null;
}

function formatScore(score) {
  if (typeof score !== "number") return "N/A";
  const rounded = Math.round(score);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function scoreClass(score) {
  if (typeof score !== "number") return "";
  return score > 0 ? "value" : score < 0 ? "reach" : "";
}

function gradeLetter(avgScore) {
  if (avgScore >= 92) return "A+";
  if (avgScore >= 86) return "A";
  if (avgScore >= 80) return "B+";
  if (avgScore >= 73) return "B";
  if (avgScore >= 65) return "C+";
  if (avgScore >= 57) return "C";
  return "D";
}

function positionCounts(picks) {
  return picks.reduce((counts, pick) => {
    const pos = (pick.player.position || "FLEX").toUpperCase();
    counts[pos] = (counts[pos] || 0) + 1;
    return counts;
  }, {});
}

function leagueRosterSlots() {
  const supplied = Array.isArray(leagueContext?.roster_positions) ? leagueContext.roster_positions : [];
  const excluded = new Set(["BN", "BENCH", "IR", "RESERVE", "TAXI"]);
  if (supplied.some((slot) => !excluded.has(String(slot).toUpperCase()))) {
    return supplied.map((slot) => String(slot).toUpperCase()).filter((slot) => !excluded.has(slot));
  }
  const s = leagueContext?.draft_settings || {};
  const mapping = [["slots_qb","QB"],["slots_rb","RB"],["slots_wr","WR"],["slots_te","TE"],["slots_flex","FLEX"],["slots_super_flex","SUPER_FLEX"],["slots_rec_flex","REC_FLEX"],["slots_k","K"],["slots_def","DEF"]];
  const slots = mapping.flatMap(([key, slot]) => Array.from({ length: Math.max(0, Number(s[key]) || 0) }, () => slot));
  return slots.length ? slots : ["QB","RB","RB","WR","WR","TE","FLEX","DEF","K"];
}

function slotEligible(slot, pos) {
  const s = String(slot).toUpperCase();
  const p = String(pos).toUpperCase();
  if (s === p) return true;
  if (["FLEX", "W/R/T", "WRRB_FLEX"].includes(s)) return ["RB","WR","TE"].includes(p);
  if (["REC_FLEX", "W/T"].includes(s)) return ["WR","TE"].includes(p);
  if (["SUPER_FLEX", "Q/W/R/T"].includes(s)) return ["QB","RB","WR","TE"].includes(p);
  return false;
}

function lineupCoverage(picks) {
  const slots = leagueRosterSlots().map((slot, index) => ({ slot, index }));
  const specificity = (slot) => ["SUPER_FLEX","FLEX","W/R/T","WRRB_FLEX","REC_FLEX","W/T"].includes(slot) ? 2 : 1;
  slots.sort((a, b) => specificity(a.slot) - specificity(b.slot));
  const pool = [...picks].sort((a, b) => lineupRank(a) - lineupRank(b));
  const assignments = [];
  for (const row of slots) {
    const idx = pool.findIndex((pick) => slotEligible(row.slot, pickPosition(pick)));
    assignments.push({ ...row, pick: idx >= 0 ? pool.splice(idx, 1)[0] : null });
  }
  assignments.sort((a, b) => a.index - b.index);
  const open = assignments.filter((row) => !row.pick).map((row) => row.slot);
  return { assignments, bench: pool, open, filled: assignments.length - open.length, total: assignments.length };
}

function leagueFormat() {
  const scoring = leagueContext?.scoring_settings || {};
  const fallback = String(leagueContext?.scoring_type || "").toLowerCase();
  const ppr = Number.isFinite(Number(scoring.rec)) ? Number(scoring.rec) : fallback === "ppr" ? 1 : fallback.includes("half") ? .5 : 0;
  const tePremium = Number(scoring.bonus_rec_te || scoring.rec_te || 0);
  const passTd = Number(scoring.pass_td || 4);
  const superflex = leagueRosterSlots().some((slot) => ["SUPER_FLEX","Q/W/R/T"].includes(slot));
  const bonuses = Object.entries(scoring).some(([key, value]) => key.startsWith("bonus_") && Number(value) > 0);
  const parts = [ppr >= .75 ? "PPR" : ppr >= .25 ? "Half PPR" : "Standard"];
  if (superflex) parts.push("Superflex");
  if (tePremium > 0) parts.push("TE premium");
  if (passTd >= 6) parts.push("6-pt pass TD");
  return { ppr, tePremium, passTd, superflex, bonuses, short: parts.join(" · "), scoring };
}

function rosterContextScore(picks, scored = []) {
  const counts = positionCounts(picks);
  const format = leagueFormat();
  const coverage = lineupCoverage(picks);
  const notes = [];
  const coverageScore = coverage.total ? 45 * coverage.filled / coverage.total : 0;

  const demanded = ["QB","RB","WR","TE"].filter((pos) => leagueRosterSlots().some((slot) => slotEligible(slot, pos)));
  const assignedCounts = positionCounts(coverage.assignments.filter((row) => row.pick).map((row) => row.pick));
  const depthHits = demanded.filter((pos) => (counts[pos] || 0) > (assignedCounts[pos] || 0)).length;
  const depthScore = demanded.length ? 20 * depthHits / demanded.length : 20;

  const target = { QB:.6, RB:1, WR:1, TE:.5, K:0, DEF:0 };
  leagueRosterSlots().forEach((slot) => {
    ["QB","RB","WR","TE","K","DEF"].forEach((pos) => { if (slotEligible(slot, pos)) target[pos] += 1 / (["QB","RB","WR","TE"].filter((p) => slotEligible(slot,p)).length || 1); });
  });
  if (format.superflex) target.QB += 1.25;
  target.WR += format.ppr * 1.2;
  target.TE += format.tePremium * 1.5;
  const relevant = ["QB","RB","WR","TE","K","DEF"];
  const targetTotal = relevant.reduce((sum, pos) => sum + target[pos], 0);
  const pickTotal = Math.max(1, relevant.reduce((sum, pos) => sum + (counts[pos] || 0), 0));
  const distance = relevant.reduce((sum, pos) => sum + Math.abs((counts[pos] || 0) / pickTotal - target[pos] / targetTotal), 0) / 2;
  const allocationScore = 15 * Math.max(0, 1 - distance);

  const avgAdp = scored.length ? scored.reduce((sum, row) => sum + row.score, 0) / scored.length : 0;
  const valueScore = Math.max(0, Math.min(15, 7.5 + avgAdp * .35));
  const signals = picks.filter((pick) => synergyForPick(pick, picks)).length;
  const strategyScore = Math.min(5, signals * 1.5);
  const score = Math.round(Math.max(0, Math.min(100, coverageScore + depthScore + allocationScore + valueScore + strategyScore)));

  if (coverage.open.length) notes.push(`open starters: ${[...new Set(coverage.open)].join(", ")}`);
  demanded.forEach((pos) => { if ((counts[pos] || 0) <= (assignedCounts[pos] || 0)) notes.push(`no ${pos} depth`); });
  if (format.superflex && (counts.QB || 0) < 2) notes.push("superflex QB depth");
  if (format.tePremium && (counts.TE || 0) < 2) notes.push("TE-premium depth");
  return { score, notes: notes.slice(0, 3), counts, coverage, format, pillars: { lineup: Math.round(coverageScore), depth: Math.round(depthScore), allocation: Math.round(allocationScore), market: Math.round(valueScore), strategy: Math.round(strategyScore) } };
}

function contextualGradeScore(picks, scored) {
  const context = rosterContextScore(picks, scored);
  return { total: context.score, context };
}

function buildTeamRecapData() {
  const slots = teamsOrder.length ? teamsOrder : Array.from({ length: currentTeams || 12 }, (_, i) => ({ slot: i + 1, name: `Team ${i + 1}` }));
  return slots.map((team) => {
    const picks = allPicks.filter((p) => Number(p.draft_slot) === Number(team.slot)).sort((a, b) => a.pick_no - b.pick_no);
    const scored = picks.map((pick) => ({ pick, score: adpScoreForPick(pick) })).filter((row) => typeof row.score === "number");
    const adpTotal = scored.reduce((sum, row) => sum + row.score, 0);
    const contextual = contextualGradeScore(picks, scored);
    const total = contextual.total;
    const avg = total;
    const best = scored.reduce((cur, row) => (!cur || row.score > cur.score ? row : cur), null);
    const worst = scored.reduce((cur, row) => (!cur || row.score < cur.score ? row : cur), null);
    const owner = team.name || team.owner_name || picks[0]?.team_name || picks[0]?.team_owner || `Team ${team.slot}`;
    return { team, owner, picks, scored, adpTotal, total, avg, best, worst, context: contextual.context, grade: picks.length ? gradeLetter(avg) : "N/A" };
  });
}

function recapSummary(teamData) {
  const p = teamData.context.pillars;
  const contextText = teamData.context.notes.length ? ` Watch: ${teamData.context.notes.join(", ")}.` : " League-fit construction is clean.";
  const marketText = teamData.scored.length ? ` Market context contributed ${p.market}/15.` : " Market data unavailable; a neutral 8/15 was used.";
  return `${teamData.total}/100 Draft Fit · lineup ${p.lineup}/45 · depth ${p.depth}/20 · allocation ${p.allocation}/15. ${marketText}${contextText}`;
}

function renderRecapAwards(teamData) {
  const ranked = [...teamData].filter((t) => t.picks.length).sort((a, b) => b.total - a.total);
  if (!ranked.length) return;
  const bestTeam = ranked[0];
  const marketPicks = ranked.flatMap((t) => t.scored);
  const bestPick = [...marketPicks].sort((a, b) => b.score - a.score)[0];
  const synergies = allPicks
    .map((pick) => ({ pick, synergy: synergyForPick(pick, allPicks) }))
    .filter((row) => row.synergy);
  const bestStack = synergies.find((row) => row.synergy.type === "stack");
  const bestHandcuff = synergies.find((row) => row.synergy.type === "handcuff");
  const mostCorrelated = [...teamData]
    .map((team) => {
      const count = synergies.filter((row) => Number(row.pick.draft_slot) === Number(team.team.slot)).length;
      return { team, count };
    })
    .sort((a, b) => b.count - a.count)[0];
  const synergyCards = [
    bestStack ? `<div class="awardcard"><div class="alabel">Best Stack</div><div class="aplayer">${escapeHtml(bestStack.pick.team_owner || bestStack.pick.team_name)}</div><div class="ameta">${escapeHtml(bestStack.synergy.main)}</div></div>` : "",
    bestHandcuff ? `<div class="awardcard"><div class="alabel">Best Handcuff</div><div class="aplayer">${escapeHtml(bestHandcuff.pick.team_owner || bestHandcuff.pick.team_name)}</div><div class="ameta">${escapeHtml(bestHandcuff.synergy.main)}</div></div>` : "",
    mostCorrelated && mostCorrelated.count > 0 ? `<div class="awardcard"><div class="alabel">Most Correlated</div><div class="aplayer">${escapeHtml(mostCorrelated.team.owner)}</div><div class="ameta">${mostCorrelated.count} teammate/stack signals found</div></div>` : ""
  ].join("");
  recapawards.innerHTML = `
    <div class="awardcard grade"><div class="alabel">Best League Fit</div><div class="aplayer">${escapeHtml(bestTeam.owner)}</div><div class="ameta">${bestTeam.grade} · ${bestTeam.total}/100 Draft Fit</div></div>
    ${bestPick ? `<div class="awardcard"><div class="alabel">Best Market Value</div><div class="aplayer">${escapeHtml(bestPick.pick.player.name)}</div><div class="ameta">${escapeHtml(bestPick.pick.team_owner || bestPick.pick.team_name)} · ${formatScore(bestPick.score)} vs ADP</div></div>` : ""}
    ${synergyCards}
    <div class="awardcard"><div class="alabel">League Format</div><div class="aplayer">${escapeHtml(leagueFormat().short)}</div><div class="ameta">Draft Fit: lineup 45 · depth 20 · allocation 15 · market 15 · strategy 5</div></div>`;
}

function renderRecapTeams(teamData) {
  recapgrid.className = "recapteams";
  recapgrid.style.zoom = "";
  recapgrid.innerHTML = teamData.map((t) => {
    const pillClass = t.total >= 73 ? "value" : t.total < 57 ? "reach" : "";
    const totalText = `${t.total}/100`;
    const rows = t.picks.map((pick) => {
      const score = adpScoreForPick(pick);
      const scoreText = typeof score === "number" ? formatScore(score) : "N/A";
      return `<div class="recapplayer">
        <div class="recappick">R${pick.round}</div>
        <div>
          <div class="recappname">${escapeHtml(pick.player.name)}</div>
          <div class="recappmeta">${escapeHtml(pick.player.position || "")} · ${escapeHtml(pick.player.team || "FA")}${pick.player.is_rookie ? " · Rookie" : pick.player.is_veteran ? " · Veteran" : ""}</div>
        </div>
        <div class="adppill ${scoreClass(score)}">${scoreText}</div>
      </div>`;
    }).join("") || `<div class="recapplayer"><div class="recappick">--</div><div><div class="recappname">No picks found</div></div><div class="adppill">N/A</div></div>`;
    return `<section class="recapteam">
      <div class="recapteam-head">
        <div class="gradebadge">${escapeHtml(t.grade)}</div>
        <div>
          <div class="recapteam-name">${escapeHtml(t.owner)}</div>
          <div class="recapteam-meta">T${escapeHtml(t.team.slot)} · ${t.picks.length} picks · ${escapeHtml(t.context.format.short)}</div>
        </div>
        <div class="scorepill ${pillClass}">${totalText}</div>
      </div>
      <div class="recapsummary">${escapeHtml(recapSummary(t))}</div>
      <div class="recapplayer-list">${rows}</div>
    </section>`;
  }).join("");
}

function pickSortValue(pick) {
  const adpScore = adpScoreForPick(pick);
  return (typeof adpScore === "number" ? adpScore : 0) - pick.pick_no * 0.04;
}

function lineupRank(pick) {
  const adp = typeof pick.adp === "number" ? pick.adp : pick.pick_no;
  return pick.pick_no * 2 + adp * 0.35;
}

function takeBestPlayer(pool, predicate, sorter = (a, b) => lineupRank(a) - lineupRank(b)) {
  const candidates = pool.filter(predicate).sort(sorter);
  const pick = candidates[0] || null;
  if (!pick) return null;
  const idx = pool.indexOf(pick);
  if (idx >= 0) pool.splice(idx, 1);
  return pick;
}

function lineupForPicks(picks) {
  const coverage = lineupCoverage(picks);
  return { starters: coverage.assignments.map((row) => ({ label: row.slot, pick: row.pick })), bench: coverage.bench.sort((a, b) => lineupRank(a) - lineupRank(b)) };
}

function lineupSlotHtml(row) {
  const pick = row.pick;
  if (!pick) {
    return `<div class="lineupslot"><div class="slotlabel">${row.label}</div><div><div class="slotplayer">Open slot</div><div class="slotmeta">No drafted player fits here</div></div><div class="adppill">--</div></div>`;
  }
  const score = adpScoreForPick(pick);
  return `<div class="lineupslot">
    <div class="slotlabel">${row.label}</div>
    <div>
      <div class="slotplayer">${escapeHtml(pick.player.name)}</div>
      <div class="slotmeta">${escapeHtml(pick.player.position || "")} · ${escapeHtml(pick.player.team || "FA")} · R${pick.round}.${pick.pick_no}</div>
    </div>
    <div class="adppill ${scoreClass(score)}">${formatScore(score)}</div>
  </div>`;
}

function renderRecapLineups(teamData) {
  recapgrid.className = "recaplineups";
  recapgrid.style.zoom = "";
  recapgrid.innerHTML = teamData.map((t) => {
    const lineup = lineupForPicks(t.picks);
    const starterHtml = lineup.starters.map(lineupSlotHtml).join("");
    const benchRows = lineup.bench.slice(0, 8).map((pick) => lineupSlotHtml({ label: "BN", pick })).join("") ||
      `<div class="lineupslot"><div class="slotlabel">BN</div><div><div class="slotplayer">No bench players</div></div><div class="adppill">--</div></div>`;
    const openSlots = lineup.starters.filter((row) => !row.pick).map((row) => row.label);
    const note = openSlots.length
      ? `Needs starter coverage at ${openSlots.join(", ")}.`
      : t.context.notes.length ? `Construction watch: ${t.context.notes.join(", ")}.` : "Clean starter build with usable bench shape.";
    return `<section class="lineupcard">
      <div class="lineuphead">
        <div><div class="lineupname">${escapeHtml(t.owner)}</div><div class="lineupmeta">${t.grade} · ${t.total}/100 Draft Fit · ${escapeHtml(t.context.format.short)}</div></div>
        <div class="scorepill ${t.total >= 73 ? "value" : t.total < 57 ? "reach" : ""}">${t.total}</div>
      </div>
      <div class="lineupsection"><div class="lineuplabel">Projected Starters</div>${starterHtml}</div>
      <div class="lineupsection"><div class="lineuplabel">Best Bench / Depth</div>${benchRows}</div>
      <div class="lineupnotes">${escapeHtml(note)}</div>
    </section>`;
  }).join("");
}

function renderRecapBoard() {
  const pickByNo = new Map(allPicks.map((p) => [p.pick_no, p]));
  const cols = teamsOrder.length || currentTeams;
  const rounds = currentRounds || Math.ceil(allPicks.length / cols);
  const headerTeams = teamsOrder.length ? teamsOrder : Array.from({ length: cols }, (_, i) => ({ slot: i + 1, name: `Team ${i + 1}` }));
  recapgrid.className = "recapboard";
  recapgrid.style.zoom = ZOOM_LEVELS[recapZoomIndex];

  const g = document.createElement("div");
  g.className = "recap-final-grid";
  g.style.gridTemplateColumns = `50px repeat(${cols}, minmax(130px, 1fr))`;
  let html = `<div class="gcell roundlabel header"></div>`;
  headerTeams.forEach((t) => { html += headerCellHtml(t); });
  for (let round = 1; round <= rounds; round++) {
    html += `<div class="gcell roundlabel">R${round}</div>`;
    for (let slot = 1; slot <= cols; slot++) {
      const pickNo = pickNoForRoundSlot(round, slot, cols);
      const pick = pickByNo.get(pickNo);
      if (pick) {
        const color = POS_COLORS[pick.player.position] || "#555";
        html += `<div class="gcell filled">
          <div class="gplayer">${escapeHtml(pick.player.name)}</div>
          <div class="gpos" style="background:${color}">${escapeHtml(pick.player.position || "")}</div>
          ${gridCellFlags(pick)}
        </div>`;
      } else {
        html += `<div class="gcell"></div>`;
      }
    }
  }
  g.innerHTML = html;
  recapgrid.replaceChildren(g);
}

function renderRecap() {
  const teamData = buildTeamRecapData();
  renderRecapAwards(teamData);
  recapTeamsBtn.classList.toggle("active", recapMode === "teams");
  recapLineupsBtn.classList.toggle("active", recapMode === "lineups");
  recapBoardBtn.classList.toggle("active", recapMode === "board");
  recapZoomBtn.style.display = recapMode === "board" ? "" : "none";
  if (recapMode === "board") renderRecapBoard();
  else if (recapMode === "lineups") renderRecapLineups(teamData);
  else renderRecapTeams(teamData);
}

function showRecap(picks) {
  if (revealing || revealQueue.length) {
    pendingRecapPicks = picks;
    return;
  }
  completeOverlay.classList.add("show");
  allPicks = picks;
  recapMode = "teams";
  recapZoomBtn.textContent = `Zoom ${Math.round(ZOOM_LEVELS[recapZoomIndex] * 100)}%`;
  renderRecap();
  if (!recapCelebrated) {
    recapCelebrated = true;
    burstReveal("#ffcc33", canvas.height * 0.28);
  }
}

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
      const recoveredPicks = broadcastSettings.mockDraftMode
        ? allRecoveredPicks.slice(-MAX_REVEAL_BACKLOG)
        : allRecoveredPicks;
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
      if (!revealing) showRestingView();
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
