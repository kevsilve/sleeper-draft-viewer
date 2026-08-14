import { readPlayerCache, writePlayerCache } from "./player-store.js";

// --------------------
// CONFIG
// --------------------
const POLL_INTERVAL = 500;
const REVEAL_GAP = 160;        // preserve pick order without making catch-up feel delayed
const MAX_BACKOFF = 5000;
const FETCH_TIMEOUT_MS = 4500; // never let one stalled Sleeper request freeze the live feed
const CLIENT_SYNC_INTERVAL = 2000;
const DEFAULT_TEAMS = 12;
const REACH_THRESHOLD = 10;    // picks of separation before we call something a reach/value
const PLAYERS_REFRESH_MS = 24 * 60 * 60 * 1000; // Sleeper asks clients to fetch this at most daily

// --------------------
// STATE (per-draft, reset on configureDraft)
// --------------------
let currentDraftId = null;

let seenPicks = new Set();
let seenTrades = new Set();

let slotTeamNames = new Map();     // draft_slot -> team display name
let slotOwnerNames = new Map();    // draft_slot -> owner display name
let slotUsernames = new Map();     // draft_slot -> raw Sleeper username
let slotAvatars = new Map();       // draft_slot -> avatar id
let rosterTeamNames = new Map();   // roster_id -> team display name
let rosterOwnerNames = new Map();  // roster_id -> owner display name
let rosterUsernames = new Map();   // roster_id -> raw Sleeper username
let rosterAvatars = new Map();     // roster_id -> avatar id
let userRosterIds = new Map();     // user_id -> roster_id

let allPicks = [];                 // full ordered history, used for grid + recap + team view
let draftMeta = null;
let leagueContext = null;          // roster/scoring rules used by live composition + recap analysis
let leagueTeamsLoaded = false;
let draftOrderSignature = "";
let lastPickTimestamp = null;
let draftComplete = false;
let pickHistoryHydrated = false;
let stateRevision = 0;

let eventQueue = [];
let processing = false;
let backoff = POLL_INTERVAL;
let metaBackoff = 1000;
let lastTradeCheckAt = 0;
let feedDelayed = false;

// Long-lived caches that persist across draft switches
const userNameCache = new Map();   // user_id -> {display_name, username}
let playersCache = new Map();      // player_id -> {years_exp, position, team, college, first_name, last_name}
let playersCacheLoadedAt = 0;
let playersCacheLoadPromise = null;
let leagueTeamsLoadPromise = null;
let leagueTeamRefreshQueued = false;
let adpCache = new Map();          // player_id -> numeric adp (overall)
let adpAvailable = false;

// --------------------
// FETCH HELPER
// --------------------
async function fetchJSON(url, { timeout = FETCH_TIMEOUT_MS } = {}) {
  const bust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url + bust, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`Timed out after ${timeout}ms: ${url}`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// --------------------
// LOCAL EVENT BUS
// --------------------
const subscribers = new Set();

function broadcast(payload) {
  for (const subscriber of subscribers) {
    try {
      subscriber(payload);
    } catch (err) {
      console.error("Draft event subscriber failed:", err);
    }
  }
}

function initialPayload() {
  if (!currentDraftId) return { type: "UNCONFIGURED" };
  return {
    type: "INIT",
    draft_id: currentDraftId,
    all_picks: allPicks,
    teams_order: buildTeamsOrder(),
    clock: currentClockPayload(seenPicks.size + 1),
    draft_complete: draftComplete,
    draft_status: draftMeta?.status || null,
    league_context: buildLeagueContext(),
    adp_available: adpAvailable,
    revision: stateRevision,
    server_time: Date.now()
  };
}

export function subscribeToDraftEvents(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function requestDraftSnapshot() {
  broadcast(initialPayload());
}

function markFeedDelayed(message) {
  if (feedDelayed) return;
  feedDelayed = true;
  broadcast({ type: "FEED_STATUS", status: "delayed", message });
}

function markFeedHealthy() {
  if (!feedDelayed) return;
  feedDelayed = false;
  broadcast({ type: "FEED_STATUS", status: "restored" });
}

function enqueue(event) {
  eventQueue.push(event);
  if (!processing) {
    processing = true;
    step();
  }
}

function step() {
  if (eventQueue.length === 0) {
    processing = false;
    return;
  }
  const event = eventQueue.shift();
  broadcast(event);
  if (eventQueue.length > 0) {
    setTimeout(step, REVEAL_GAP);
  } else {
    processing = false;
  }
}

// --------------------
// DRAFT CONFIGURATION / SWITCHING
// --------------------
function resetDraftState() {
  seenPicks = new Set();
  seenTrades = new Set();
  slotTeamNames = new Map();
  slotOwnerNames = new Map();
  slotUsernames = new Map();
  slotAvatars = new Map();
  rosterTeamNames = new Map();
  rosterOwnerNames = new Map();
  rosterUsernames = new Map();
  rosterAvatars = new Map();
  userRosterIds = new Map();
  allPicks = [];
  draftMeta = null;
  leagueContext = null;
  leagueTeamsLoaded = false;
  leagueTeamRefreshQueued = false;
  draftOrderSignature = "";
  lastPickTimestamp = null;
  draftComplete = false;
  pickHistoryHydrated = false;
  eventQueue = [];
  processing = false;
  backoff = POLL_INTERVAL;
  metaBackoff = 1000;
  feedDelayed = false;
  stateRevision++;
}

export async function configureDraft(draftId) {
  // Validate first so we don't tear down a working draft on a bad ID
  const meta = await fetchJSON(`https://api.sleeper.app/v1/draft/${draftId}`);
  if (!meta || meta.error) throw new Error("Draft not found");

  currentDraftId = draftId;
  resetDraftState();
  draftMeta = meta;
  leagueContext = draftFallbackContext(meta);

  // Identity data is small and worth having before the first frame. Player and
  // ADP datasets are much larger, so warm them without holding up live picks.
  await Promise.allSettled([primeTrades(), loadLeagueTeams()]);
  await syncDraftOrderFromMeta(meta, { force: true });
  loadADP().catch(() => {});

  // Tell any connected clients to reload and re-fetch fresh state
  broadcast({ type: "RESET" });

  return meta;
}

export async function validateDraft(draftId) {
  const normalized = String(draftId || "").trim();
  if (!normalized) throw new Error("draft_id is required");
  const meta = await fetchJSON(`https://api.sleeper.app/v1/draft/${normalized}`);
  if (!meta || meta.error) throw new Error("Draft not found");
  return meta;
}

export function getDraftStatus() {
  return {
    configured: !!currentDraftId,
    draft_id: currentDraftId,
    season: draftMeta?.season || null,
    status: draftMeta?.status || null,
    teams: draftMeta?.settings?.teams || null,
    adp_available: adpAvailable
  };
}

// --------------------
// TEAM / OWNER RESOLUTION
// --------------------
async function getUserInfo(userId) {
  if (!userId || userId === "0") return null;
  if (userNameCache.has(userId)) return userNameCache.get(userId);
  try {
    const u = await fetchJSON(`https://api.sleeper.app/v1/user/${userId}`);
    const info = {
      display_name: u?.display_name || u?.username || null,
      username: u?.username || null,
      avatar: u?.avatar || null
    };
    userNameCache.set(userId, info);
    return info;
  } catch {
    return null;
  }
}

function setSlotIdentity(slot, identity) {
  if (!slot || !identity) return;
  const name = identity.name || identity.owner_name || `Team ${slot}`;
  const ownerName = identity.owner_name || name;
  slotTeamNames.set(Number(slot), name);
  slotOwnerNames.set(Number(slot), ownerName);
  slotUsernames.set(Number(slot), identity.username || ownerName);
  slotAvatars.set(Number(slot), identity.avatar || null);
}

function rosterIdentity(rosterId) {
  if (!rosterId || !rosterTeamNames.has(rosterId)) return null;
  const name = rosterTeamNames.get(rosterId);
  const ownerName = rosterOwnerNames.get(rosterId) || name;
  return {
    name,
    owner_name: ownerName,
    username: rosterUsernames.get(rosterId) || ownerName,
    avatar: rosterAvatars.get(rosterId) || null
  };
}

// Preferred path: if the draft belongs to a league, pull real team names/usernames/avatars
// from rosters+users in two calls instead of guessing per-pick.
function loadLeagueTeams() {
  if (leagueTeamsLoaded || !draftMeta?.league_id) return Promise.resolve();
  if (!leagueTeamsLoadPromise) {
    leagueTeamsLoadPromise = loadLeagueTeamsUncached().finally(() => { leagueTeamsLoadPromise = null; });
  }
  return leagueTeamsLoadPromise;
}

async function loadLeagueTeamsUncached() {
  if (leagueTeamsLoaded || !draftMeta?.league_id) return;
  const loadingDraftId = currentDraftId;
  const leagueId = draftMeta.league_id;
  try {
    const [rosters, users, league] = await Promise.all([
      fetchJSON(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
      fetchJSON(`https://api.sleeper.app/v1/league/${leagueId}/users`),
      fetchJSON(`https://api.sleeper.app/v1/league/${leagueId}`)
    ]);
    if (loadingDraftId !== currentDraftId || leagueId !== draftMeta?.league_id) return;
    const userById = new Map(users.map((u) => [u.user_id, u]));
    leagueContext = {
      league_id: leagueId,
      name: league?.name || draftMeta?.metadata?.name || "Sleeper league",
      roster_positions: Array.isArray(league?.roster_positions) ? league.roster_positions : [],
      scoring_settings: league?.scoring_settings || {},
      draft_settings: draftMeta?.settings || {},
      scoring_type: draftMeta?.metadata?.scoring_type || null
    };
    for (const r of rosters) {
      const u = userById.get(r.owner_id);
      if (r.owner_id) {
        userRosterIds.set(r.owner_id, r.roster_id);
      }
      const ownerName = u?.display_name || u?.username || `Owner ${r.roster_id}`;
      const teamName = u?.metadata?.team_name || ownerName || `Team ${r.roster_id}`;
      rosterTeamNames.set(r.roster_id, teamName);
      rosterOwnerNames.set(r.roster_id, ownerName);
      rosterUsernames.set(r.roster_id, u?.username || ownerName || teamName);
      rosterAvatars.set(r.roster_id, u?.avatar || null);
    }

    // Roster identities are stable league data. Slot assignments are rebuilt
    // separately from the latest draft_order so a moved owner cannot linger in
    // both their old and new positions.
    leagueTeamsLoaded = true;
  } catch (err) {
    console.error("Failed to load league teams:", err.message);
  }
}

function draftFallbackContext(meta = draftMeta) {
  return {
    league_id: meta?.league_id || null,
    name: meta?.metadata?.name || "Sleeper draft",
    roster_positions: [],
    scoring_settings: {},
    draft_settings: meta?.settings || {},
    scoring_type: meta?.metadata?.scoring_type || null
  };
}

function buildLeagueContext() {
  return leagueContext || draftFallbackContext();
}

function refreshLeagueTeamsInBackground(draftId) {
  if (leagueTeamRefreshQueued || leagueTeamsLoaded || !draftMeta?.league_id) return;
  leagueTeamRefreshQueued = true;
  loadLeagueTeams().then(async () => {
    if (draftId !== currentDraftId || !leagueTeamsLoaded) return;
    await syncDraftOrderFromMeta(draftMeta, { force: true });
    broadcast({ type: "TEAMS", teams_order: buildTeamsOrder(), clock: currentClockPayload(allPicks.length + 1) });
  }).catch(() => {}).finally(() => { leagueTeamRefreshQueued = false; });
}

function draftOrderKey(order) {
  if (!order || typeof order !== "object") return "";
  return Object.entries(order)
    .map(([userId, slot]) => `${userId}:${slot}`)
    .sort()
    .join("|");
}

async function syncDraftOrderFromMeta(meta, { force = false } = {}) {
  if (!meta?.draft_order) return false;
  const signature = draftOrderKey(meta.draft_order);
  if (!force && signature === draftOrderSignature) return false;

  const assignments = await Promise.all(Object.entries(meta.draft_order).map(async ([userId, rawSlot]) => {
    const slot = Number(rawSlot);
    if (!slot) return null;
    const rosterId = userRosterIds.get(userId);
    const knownRoster = rosterIdentity(rosterId);
    if (knownRoster) return { userId, slot, identity: knownRoster };

    const info = await getUserInfo(userId);
    const ownerName = info?.display_name || info?.username || `Team ${slot}`;
    return {
      userId,
      slot,
      identity: {
        name: ownerName,
        owner_name: ownerName,
        username: info?.username || ownerName,
        avatar: info?.avatar || null
      }
    };
  }));

  // Replace all four maps as a single authoritative snapshot. Clearing first
  // is the essential part of the moved-seat fix; building off to the side also
  // prevents clients from observing a half-updated order during async lookups.
  const nextTeamNames = new Map();
  const nextOwnerNames = new Map();
  const nextUsernames = new Map();
  const nextAvatars = new Map();
  for (const assignment of assignments) {
    if (!assignment) continue;
    const { slot, identity } = assignment;
    const name = identity.name || identity.owner_name || `Team ${slot}`;
    const ownerName = identity.owner_name || name;
    nextTeamNames.set(slot, name);
    nextOwnerNames.set(slot, ownerName);
    nextUsernames.set(slot, identity.username || ownerName);
    nextAvatars.set(slot, identity.avatar || null);
  }
  slotTeamNames = nextTeamNames;
  slotOwnerNames = nextOwnerNames;
  slotUsernames = nextUsernames;
  slotAvatars = nextAvatars;

  draftOrderSignature = signature;
  stateRevision++;
  return true;
}

async function resolveTeam(pick) {
  const slot = pick.draft_slot;
  const rosterId = pick.roster_id;

  // A traded pick belongs to roster_id, not necessarily the original draft
  // slot. Prefer that identity so the "Drafted by" callout is truthful.
  if (rosterId && rosterTeamNames.has(rosterId)) {
    return rosterIdentity(rosterId);
  }
  if (slot && slotTeamNames.has(slot)) {
    return {
      name: slotTeamNames.get(slot),
      owner_name: slotOwnerNames.get(slot) || slotTeamNames.get(slot),
      username: slotUsernames.get(slot) || slotTeamNames.get(slot),
      avatar: slotAvatars.get(slot)
    };
  }
  const info = await getUserInfo(pick.picked_by);
  const name = info?.display_name || `Team ${slot ?? rosterId ?? "?"}`;
  const ownerName = info?.display_name || name;
  const username = info?.username || name;
  const avatar = info?.avatar || null;
  setSlotIdentity(slot, { name, owner_name: ownerName, username, avatar });
  if (rosterId) { rosterTeamNames.set(rosterId, name); rosterOwnerNames.set(rosterId, ownerName); rosterUsernames.set(rosterId, username); rosterAvatars.set(rosterId, avatar); }
  return { name, owner_name: ownerName, username, avatar };
}

// --------------------
// SNAKE DRAFT MATH
// --------------------
export function slotForPick(pickNo, teams) {
  const round = Math.ceil(pickNo / teams);
  const posInRound = ((pickNo - 1) % teams) + 1;
  const slot = round % 2 === 1 ? posInRound : teams - posInRound + 1;
  return { round, slot };
}

function guessTeams() {
  if (draftMeta?.settings?.teams) return draftMeta.settings.teams;
  let max = DEFAULT_TEAMS;
  for (const p of allPicks) if (p.draft_slot > max) max = p.draft_slot;
  return max;
}

function currentClockPayload(nextPickNo) {
  const teams = guessTeams();
  const pickTimer = draftMeta?.settings?.pick_timer || 0;
  const rounds = draftMeta?.settings?.rounds || null;
  const { round, slot } = slotForPick(nextPickNo, teams);
  const onClock = slotTeamNames.get(slot) || `Team ${slot}`;
  const onClockOwner = slotOwnerNames.get(slot) || onClock;
  const onClockAvatar = slotAvatars.get(slot) || null;

  const totalPicks = rounds ? teams * rounds : null;
  const onDeck = [];
  for (let i = 1; i <= 5; i++) {
    const pn = nextPickNo + i;
    if (totalPicks && pn > totalPicks) break;
    const s = slotForPick(pn, teams);
    onDeck.push({
      pick_no: pn,
      round: s.round,
      slot: s.slot,
      name: slotTeamNames.get(s.slot) || `Team ${s.slot}`,
      owner_name: slotOwnerNames.get(s.slot) || slotTeamNames.get(s.slot) || `Team ${s.slot}`,
      avatar: slotAvatars.get(s.slot) || null
    });
  }

  let deadline = null;
  if (pickTimer > 0) {
    const base = lastPickTimestamp || draftMeta?.start_time || Date.now();
    deadline = base + pickTimer * 1000;
  }

  return {
    type: "CLOCK",
    pick_no: nextPickNo,
    round,
    rounds,
    teams,
    draft_status: draftMeta?.status || null,
    on_clock: onClock,
    on_clock_owner: onClockOwner,
    on_clock_avatar: onClockAvatar,
    on_deck: onDeck,
    deadline,
    pick_timer: pickTimer
  };
}

function buildTeamsOrder() {
  const teams = guessTeams();
  const order = [];
  for (let slot = 1; slot <= teams; slot++) {
    order.push({
      slot,
      name: slotTeamNames.get(slot) || `Team ${slot}`,
      owner_name: slotOwnerNames.get(slot) || slotTeamNames.get(slot) || `Team ${slot}`,
      username: slotUsernames.get(slot) || slotTeamNames.get(slot) || `Team ${slot}`,
      avatar: slotAvatars.get(slot) || null
    });
  }
  return order;
}

// --------------------
// PLAYERS CACHE (rookie detection, college, backfill)
// --------------------
function loadPlayersCache() {
  const age = Date.now() - playersCacheLoadedAt;
  if (playersCacheLoadedAt && age < PLAYERS_REFRESH_MS) return Promise.resolve();
  if (!playersCacheLoadPromise) {
    playersCacheLoadPromise = loadPlayersCacheUncached().finally(() => { playersCacheLoadPromise = null; });
  }
  return playersCacheLoadPromise;
}

async function loadPlayersCacheUncached() {
  const cached = await readPlayerCache();
  if (cached?.players) {
    playersCache = new Map(Object.entries(cached.players));
    playersCacheLoadedAt = cached.savedAt || 0;
    backfillExperienceTags();
    if (Date.now() - playersCacheLoadedAt < PLAYERS_REFRESH_MS) return;
  }

  try {
    const raw = await fetchJSON(`https://api.sleeper.app/v1/players/nfl`);
    const next = new Map();
    for (const [id, p] of Object.entries(raw || {})) {
      if (!p) continue;
      next.set(id, {
        years_exp: typeof p.years_exp === "number" ? p.years_exp : null,
        position: p.position || null,
        team: p.team || null,
        college: p.college || null,
        first_name: p.first_name || "",
        last_name: p.last_name || "",
        age: Number.isFinite(Number(p.age)) ? Number(p.age) : null,
        number: p.number ?? null,
        height: p.height || null,
        weight: p.weight || null,
        depth_chart_order: Number.isFinite(Number(p.depth_chart_order)) ? Number(p.depth_chart_order) : null,
        depth_chart_position: p.depth_chart_position ?? null,
        injury_status: p.injury_status || null,
        status: p.status || null
      });
    }
    playersCache = next;
    playersCacheLoadedAt = Date.now();
    await writePlayerCache(Object.fromEntries(next), playersCacheLoadedAt);
    backfillExperienceTags();
    console.log(`Players cache loaded: ${playersCache.size} players`);
  } catch (err) {
    console.error(cached ? "Using stale player cache:" : "Failed to load players cache:", err.message);
  }
}

function backfillExperienceTags() {
  const updates = [];
  for (const pick of allPicks) {
    const cached = playersCache.get(String(pick.player?.id));
    const years = typeof cached?.years_exp === "number" ? cached.years_exp : null;
    if (years == null) continue;
    const next = {
      years_exp: years,
      is_rookie: years === 0,
      is_veteran: years > 0,
      college: years === 0 ? (pick.player.college || cached.college || null) : null,
      age: cached.age,
      number: cached.number,
      height: cached.height,
      weight: cached.weight,
      depth_chart_order: cached.depth_chart_order,
      depth_chart_position: cached.depth_chart_position,
      injury_status: cached.injury_status,
      status: cached.status
    };
    if (
      pick.player.years_exp === next.years_exp &&
      pick.player.is_rookie === next.is_rookie &&
      pick.player.is_veteran === next.is_veteran &&
      pick.player.college === next.college &&
      pick.player.age === next.age &&
      pick.player.depth_chart_order === next.depth_chart_order &&
      pick.player.injury_status === next.injury_status
    ) continue;
    Object.assign(pick.player, next);
    updates.push({ pick_no: pick.pick_no, player: next });
  }
  if (updates.length) {
    stateRevision++;
    broadcast({ type: "PICK_TAGS", revision: stateRevision, updates });
  }
}

function playerExperienceYears(pick, meta) {
  const metadataYears = Number(meta?.years_exp);
  if (meta?.years_exp !== "" && meta?.years_exp != null && Number.isFinite(metadataYears) && metadataYears >= 0) {
    return metadataYears;
  }
  const cached = playersCache.get(String(pick.player_id));
  return typeof cached?.years_exp === "number" && cached.years_exp >= 0 ? cached.years_exp : null;
}

function isRookie(pick, meta) {
  return playerExperienceYears(pick, meta) === 0;
}

function isVeteran(pick, meta) {
  const years = playerExperienceYears(pick, meta);
  return typeof years === "number" && years > 0;
}

// --------------------
// ADP (best effort — Sleeper does not officially document a public ADP
// endpoint, so this uses their community-known research endpoint and
// degrades quietly if the shape changes or the request fails).
// --------------------
function currentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  // Before March, "this season" for fantasy purposes is still last year's.
  return now.getMonth() < 2 ? year - 1 : year;
}

export function normalizePlayerName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function playerNameLookup() {
  const lookup = new Map();
  for (const [playerId, p] of playersCache.entries()) {
    const name = normalizePlayerName(`${p.first_name || ""} ${p.last_name || ""}`);
    if (!name) continue;
    if (!lookup.has(name)) lookup.set(name, []);
    lookup.get(name).push({
      id: playerId,
      position: (p.position || "").toUpperCase(),
      team: (p.team || "").toUpperCase()
    });
  }
  return lookup;
}

function matchAdpPlayer(row, lookup) {
  const candidates = lookup.get(normalizePlayerName(row.name));
  if (!candidates || candidates.length === 0) return null;
  const pos = (row.position || "").toUpperCase();
  const team = (row.team || "").toUpperCase();
  return (
    candidates.find((p) => p.position === pos && p.team === team) ||
    candidates.find((p) => p.position === pos) ||
    candidates.find((p) => p.team === team) ||
    candidates[0]
  )?.id || null;
}

async function loadFantasyFootballCalculatorADP(season) {
  await loadPlayersCache();
  if (playersCache.size === 0) return 0;

  const lookup = playerNameLookup();
  const formats = ["half-ppr", "ppr", "standard"];
  const merged = new Map(); // player_id -> { total, count }
  for (const format of formats) {
    try {
      const raw = await fetchJSON(
        `https://fantasyfootballcalculator.com/api/v1/adp/${format}?position=all&teams=12&year=${season}`
      );
      const rows = Array.isArray(raw?.players) ? raw.players : Array.isArray(raw) ? raw : [];
      let found = 0;
      for (const row of rows) {
        const adp = Number(row.adp || row.average_pick || row.overall || row.pick);
        if (!adp || Number.isNaN(adp) || adp <= 0) continue;
        const playerId = matchAdpPlayer(
          {
            name: row.name || row.player_name || row.full_name,
            position: row.position,
            team: row.team
          },
          lookup
        );
        if (!playerId) continue;
        const key = String(playerId);
        const cur = merged.get(key) || { total: 0, count: 0 };
        cur.total += adp;
        cur.count++;
        merged.set(key, cur);
        found++;
      }
      console.log(`Fantasy Football Calculator ${format} ADP matched ${found} players.`);
    } catch (err) {
      console.log(`Fantasy Football Calculator ${format} ADP unavailable (${err.message}).`);
    }
  }
  for (const [playerId, v] of merged.entries()) {
    adpCache.set(playerId, v.total / v.count);
  }
  if (merged.size > 20) {
    console.log(`Fantasy Football Calculator blended ADP loaded for ${merged.size} players across ${formats.length} formats.`);
  }
  return merged.size;
}

async function loadADP() {
  adpCache = new Map();
  adpAvailable = false;
  const season = draftMeta?.season || currentSeason();
  // 1 = std, 2 = half-ppr, 3 = ppr (community-documented, unofficial)
  const scoringGuess = 2;
  try {
    const raw = await fetchJSON(
      `https://api.sleeper.app/players/nfl/research/regular/${season}/${scoringGuess}`
    );
    if (!raw || typeof raw !== "object") throw new Error("empty Sleeper ADP response");
    let found = 0;
    for (const [playerId, stats] of Object.entries(raw)) {
      if (!stats || typeof stats !== "object") continue;
      const adpKey = Object.keys(stats).find((k) => k.toLowerCase().includes("adp"));
      const val = adpKey ? Number(stats[adpKey]) : null;
      if (val && !Number.isNaN(val) && val > 0) {
        adpCache.set(playerId, val);
        found++;
      }
    }
    adpAvailable = found > 20; // sanity threshold — if barely anything parsed, treat as unavailable
    console.log(adpAvailable
      ? `ADP data loaded for ${found} players.`
      : `ADP endpoint responded but no usable ADP values were found — reach/drop indicators disabled.`);
  } catch (err) {
    console.log(`ADP data unavailable from Sleeper this session (${err.message}). Trying Fantasy Football Calculator fallback...`);
  }

  if (!adpAvailable) console.log("No usable ADP source found this session - reach/value indicators disabled.");
}

function adpInfoFor(playerId, pickNo) {
  const adp = adpCache.get(String(playerId));
  if (!adp) return { adp: null, diff: null, flag: null };
  const diff = Math.round(adp - pickNo); // positive = went earlier than expected (reach)
  let flag = null;
  if (diff >= REACH_THRESHOLD) flag = "reach";
  else if (diff <= -REACH_THRESHOLD) flag = "value";
  return { adp: Math.round(adp), diff, flag };
}

// --------------------
// TRADED PICKS
// --------------------
async function checkTradedPicks() {
  if (!currentDraftId) return;
  try {
    const trades = await fetchJSON(
      `https://api.sleeper.app/v1/draft/${currentDraftId}/traded_picks`
    );
    if (!Array.isArray(trades)) return;

    for (const t of trades) {
      const key = `${t.season}-${t.round}-${t.roster_id}-${t.owner_id}-${t.previous_owner_id}`;
      if (seenTrades.has(key)) continue;
      seenTrades.add(key);

      const fromName =
        rosterTeamNames.get(t.previous_owner_id) || `Team (roster ${t.previous_owner_id})`;
      const toName = rosterTeamNames.get(t.owner_id) || `Team (roster ${t.owner_id})`;

      enqueue({
        type: "TRADE",
        ts: Date.now(),
        data: { round: t.round, from: fromName, to: toName }
      });
    }
  } catch (err) {
    // traded_picks 404s for drafts with no trades set up yet — ignore quietly
  }
}

async function primeTrades() {
  if (!currentDraftId) return;
  try {
    const trades = await fetchJSON(
      `https://api.sleeper.app/v1/draft/${currentDraftId}/traded_picks`
    );
    if (Array.isArray(trades)) {
      for (const t of trades) {
        const key = `${t.season}-${t.round}-${t.roster_id}-${t.owner_id}-${t.previous_owner_id}`;
        seenTrades.add(key);
      }
    }
  } catch {}
}

// --------------------
// POLLING ENGINE
// --------------------
async function pollDraft() {
  if (!currentDraftId) {
    setTimeout(pollDraft, 1000);
    return;
  }
  try {
    const polledDraftId = currentDraftId;
    const picks = await fetchJSON(`https://api.sleeper.app/v1/draft/${polledDraftId}/picks`, { timeout: 3200 });
    if (polledDraftId !== currentDraftId) return;

    // Large enrichment data runs beside the critical poll path. It can improve
    // the next reveal, but it can never delay this one.
    loadPlayersCache().catch(() => {});
    refreshLeagueTeamsInBackground(polledDraftId);

    if (Array.isArray(picks)) {
      const sorted = [...picks].sort((a, b) => a.pick_no - b.pick_no);
      const hydratingHistory = !pickHistoryHydrated;

      for (const pick of sorted) {
        if (seenPicks.has(pick.pick_no)) continue;
        seenPicks.add(pick.pick_no);

        const team = await resolveTeam(pick);
        const m = pick.metadata || {};
        const yearsExp = playerExperienceYears(pick, m);
        const rookie = isRookie(pick, m);
        const veteran = isVeteran(pick, m);
        const adpInfo = adpInfoFor(pick.player_id, pick.pick_no);
        const cachedPlayer = playersCache.get(String(pick.player_id)) || {};

        const enriched = {
          pick_no: pick.pick_no,
          round: pick.round,
          draft_slot: pick.draft_slot,
          roster_id: pick.roster_id,
          picked_by: pick.picked_by,
          team_name: team.name,
          team_owner: team.owner_name,
          team_username: team.username,
          team_avatar: team.avatar,
          player: {
            id: pick.player_id,
            name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Unknown Player",
            position: m.position ?? "",
            team: m.team ?? "",
            is_rookie: rookie,
            is_veteran: veteran,
            years_exp: yearsExp,
            college: rookie ? (cachedPlayer.college || null) : null,
            age: cachedPlayer.age ?? null,
            number: cachedPlayer.number ?? m.number ?? null,
            height: cachedPlayer.height ?? null,
            weight: cachedPlayer.weight ?? null,
            depth_chart_order: cachedPlayer.depth_chart_order ?? null,
            depth_chart_position: cachedPlayer.depth_chart_position ?? null,
            injury_status: cachedPlayer.injury_status || m.injury_status || null,
            status: cachedPlayer.status || m.status || null
          },
          adp: adpInfo.adp,
          adp_diff: adpInfo.diff,
          adp_flag: adpInfo.flag
        };

        allPicks.push(enriched);
        stateRevision++;
        if (!hydratingHistory) enqueue({ type: "PICK", ts: Date.now(), data: enriched });
        console.log(`Pick ${pick.pick_no}: ${enriched.player.name} -> ${team.name}${rookie ? " (R)" : veteran ? " (VET)" : ""}`);
      }
      if (hydratingHistory) {
        pickHistoryHydrated = true;
        broadcast({ type: "HISTORY", all_picks: allPicks, clock: currentClockPayload(allPicks.length + 1), league_context: buildLeagueContext() });
      }
    }

    if (draftMeta?.status === "complete" && !draftComplete) {
      draftComplete = true;
      stateRevision++;
      enqueue({ type: "COMPLETE", ts: Date.now(), all_picks: allPicks });
    }

    broadcast(currentClockPayload(seenPicks.size + 1));

    // Trades are low frequency; avoid making an extra upstream request 2.5x/sec.
    if (Date.now() - lastTradeCheckAt >= 5000) {
      lastTradeCheckAt = Date.now();
      checkTradedPicks();
    }

    markFeedHealthy();
    backoff = POLL_INTERVAL;
  } catch (err) {
    console.error("Polling error:", err.message);
    markFeedDelayed(err.message);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  } finally {
    setTimeout(pollDraft, backoff);
  }
}

// Metadata has its own loop so a slow draft-room response can never hold a
// completed pick hostage. It owns seat changes, clock anchors, and team order;
// the faster loop above owns the pick stream.
async function pollDraftMeta() {
  if (!currentDraftId) {
    setTimeout(pollDraftMeta, 1000);
    return;
  }
  try {
    const polledDraftId = currentDraftId;
    const meta = await fetchJSON(`https://api.sleeper.app/v1/draft/${polledDraftId}`, { timeout: 3200 });
    if (polledDraftId !== currentDraftId) return;
    draftMeta = meta;
    if (meta?.last_picked) lastPickTimestamp = meta.last_picked;
    refreshLeagueTeamsInBackground(polledDraftId);
    const teamsChanged = await syncDraftOrderFromMeta(meta);
    if (teamsChanged) {
      broadcast({ type: "TEAMS", teams_order: buildTeamsOrder(), clock: currentClockPayload(allPicks.length + 1) });
    } else {
      broadcast(currentClockPayload(allPicks.length + 1));
    }
    markFeedHealthy();
    metaBackoff = 1000;
  } catch (err) {
    console.error("Metadata polling error:", err.message);
    markFeedDelayed(err.message);
    metaBackoff = Math.min(metaBackoff * 1.6, MAX_BACKOFF);
  } finally {
    setTimeout(pollDraftMeta, metaBackoff);
  }
}

// --------------------
// DRAFT DISCOVERY
// --------------------
function seasonCandidates() {
  const s = currentSeason();
  // Cover last season (mocks/leagues that haven't rolled over yet), this season,
  // and next season (early best-ball / rookie mocks that Sleeper already tags
  // with next year's season number even though our local heuristic hasn't flipped yet).
  return [String(s - 1), String(s), String(s + 1)];
}

export async function detectDraftsForUsername(username) {
  const user = await fetchJSON(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`);
  if (!user || !user.user_id) throw new Error("Sleeper user not found");

  const allDrafts = [];
  const leagueMeta = new Map(); // league_id -> { draft_id, name }

  for (const season of seasonCandidates()) {
    // Standalone mocks (no league at all) surface here.
    try {
      const userDrafts = await fetchJSON(`https://api.sleeper.app/v1/user/${user.user_id}/drafts/nfl/${season}`);
      if (Array.isArray(userDrafts)) allDrafts.push(...userDrafts);
    } catch {
      // no drafts for that season — fine
    }

    // This endpoint only reliably returns each league's *official* draft —
    // practice/mock drafts run inside a league don't show up here. So we
    // also walk every league the user belongs to and ask each one directly
    // for its full list of draft objects, which does include practice drafts.
    let leagues = [];
    try {
      leagues = await fetchJSON(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${season}`);
    } catch {
      // no leagues for that season — fine
    }
    if (!Array.isArray(leagues)) continue;

    await Promise.all(
      leagues.map(async (league) => {
        leagueMeta.set(league.league_id, { draft_id: league?.draft_id || null, name: league?.name || null });
        try {
          const leagueDrafts = await fetchJSON(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`);
          if (Array.isArray(leagueDrafts)) allDrafts.push(...leagueDrafts);
        } catch {
          // some leagues 404 this before a draft exists yet — fine
        }
      })
    );
  }

  const byId = new Map(allDrafts.map((d) => [d.draft_id, d]));
  const drafts = [...byId.values()];

  // Rank: actively drafting first, then pre-draft, then complete; newest first within tier
  const statusRank = { drafting: 0, paused: 0, pre_draft: 1, complete: 2 };
  drafts.sort((a, b) => {
    const ra = statusRank[a.status] ?? 3;
    const rb = statusRank[b.status] ?? 3;
    if (ra !== rb) return ra - rb;
    return (b.start_time || b.created || 0) - (a.start_time || a.created || 0);
  });

  return {
    user: { user_id: user.user_id, username: user.username, display_name: user.display_name, avatar: user.avatar },
    drafts: drafts.map((d) => {
      const li = d.league_id ? leagueMeta.get(d.league_id) : null;
      const isOfficial = !!li && !!li.draft_id && li.draft_id === d.draft_id;
      // 'league'   = the league's real, official startup draft
      // 'practice' = a mock/practice draft created inside a real league (same league_id, different draft_id)
      // 'mock'     = a standalone mock draft with no league at all
      const kind = !d.league_id ? "mock" : isOfficial ? "league" : "practice";
      return {
        draft_id: d.draft_id,
        league_id: d.league_id,
        league_name: li?.name || null,
        kind,
        status: d.status,
        season: d.season,
        teams: d.settings?.teams,
        rounds: d.settings?.rounds,
        created: d.created,
        start_time: d.start_time,
        metadata_name: d.metadata?.name || null
      };
    })
  };
}

// --------------------
// LEGACY SERVER STARTUP (kept commented for migration traceability)
// --------------------
/*
(async () => {
  // Warm the large player file only when a draft is active. This keeps the
  // setup screen responsive on slower machines and restricted networks.
  setInterval(() => {
    if (currentDraftId) loadPlayersCache();
  }, PLAYERS_REFRESH_MS);

  if (PRECONFIGURED_DRAFT_ID) {
    try {
      await configureDraft(PRECONFIGURED_DRAFT_ID);
      console.log(`Configured from DRAFT_ID env: ${PRECONFIGURED_DRAFT_ID}`);
    } catch (err) {
      console.error("Failed to configure DRAFT_ID from env:", err.message);
    }
  } else if (SLEEPER_USERNAME) {
    try {
      const { drafts } = await detectDraftsForUsername(SLEEPER_USERNAME);
      const pick = drafts.find((d) => d.status === "drafting") || drafts[0];
      if (pick) {
        await configureDraft(pick.draft_id);
        console.log(`Auto-detected draft for ${SLEEPER_USERNAME}: ${pick.draft_id} (${pick.status})`);
      } else {
        console.log(`No drafts found for ${SLEEPER_USERNAME} — waiting for manual selection via the web UI.`);
      }
    } catch (err) {
      console.error("Auto-detect failed:", err.message);
    }
  } else {
    console.log("No DRAFT_ID or SLEEPER_USERNAME set — open the web UI to search for or enter a draft.");
  }

  pollDraft();
  pollDraftMeta();
})();
*/

let engineStarted = false;

export function startDraftEngine() {
  if (engineStarted) return;
  engineStarted = true;

  setInterval(() => {
    if (currentDraftId) loadPlayersCache();
  }, PLAYERS_REFRESH_MS);

  setInterval(() => {
    if (!currentDraftId) return;
    broadcast({
      type: "SYNC",
      draft_id: currentDraftId,
      revision: stateRevision,
      pick_count: allPicks.length,
      server_time: Date.now()
    });
  }, CLIENT_SYNC_INTERVAL);

  pollDraft();
  pollDraftMeta();
}

export function forceDraftResync() {
  requestDraftSnapshot();
}
