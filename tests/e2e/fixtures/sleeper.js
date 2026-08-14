export const LIVE_DRAFT_ID = "12345678901234567";
export const COMPLETE_DRAFT_ID = "22345678901234567";
export const PRACTICE_DRAFT_ID = "32345678901234567";

const LEAGUE_ID = "fixture-league";
const FIXED_TIME = Date.UTC(2026, 7, 14, 18, 0, 0);
const POSITIONS = ["RB", "WR", "QB", "TE"];
const NFL_TEAMS = ["BUF", "KC", "PHI", "DET"];

export const owners = Array.from({ length: 12 }, (_, index) => ({
  user_id: `fixture-owner-${index + 1}`,
  username: `fixture_owner_${index + 1}`,
  display_name: `Fixture Owner ${index + 1}`,
  avatar: null,
  metadata: { team_name: `Fixture Team ${index + 1}` }
}));

export const rosters = owners.map((owner, index) => ({
  roster_id: index + 1,
  owner_id: owner.user_id,
  players: []
}));

export const players = Object.fromEntries(
  Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    return [`fixture-player-${number}`, {
      first_name: "Fixture",
      last_name: `Player ${number}`,
      position: POSITIONS[index % POSITIONS.length],
      team: NFL_TEAMS[index % NFL_TEAMS.length],
      years_exp: index % 3,
      age: 22 + (index % 8),
      number,
      college: `Fixture University ${number}`
    }];
  })
);

export const adp = Object.fromEntries(
  Object.keys(players).map((playerId, index) => [playerId, { pts_ppr_adp: index + 1 }])
);

export function makePick(pickNo, draftId = LIVE_DRAFT_ID) {
  const round = Math.ceil(pickNo / 12);
  const positionInRound = ((pickNo - 1) % 12) + 1;
  const draftSlot = round % 2 === 1 ? positionInRound : 13 - positionInRound;
  const playerId = `fixture-player-${pickNo}`;
  const player = players[playerId];

  return {
    draft_id: draftId,
    player_id: playerId,
    picked_by: owners[draftSlot - 1].user_id,
    roster_id: draftSlot,
    round,
    draft_slot: draftSlot,
    pick_no: pickNo,
    metadata: {
      first_name: player.first_name,
      last_name: player.last_name,
      position: player.position,
      team: player.team,
      years_exp: String(player.years_exp)
    }
  };
}

function makeDraftMeta({
  draftId = LIVE_DRAFT_ID,
  status = "drafting",
  rounds = 15,
  leagueId = LEAGUE_ID,
  name = "Live 12-Team Fixture"
} = {}) {
  return {
    draft_id: draftId,
    league_id: leagueId,
    status,
    season: "2026",
    created: FIXED_TIME - 86_400_000,
    start_time: FIXED_TIME,
    last_picked: null,
    draft_order: Object.fromEntries(owners.map((owner, index) => [owner.user_id, index + 1])),
    settings: { teams: 12, rounds, pick_timer: 120 },
    metadata: { name, scoring_type: "ppr" }
  };
}

const liveDraft = makeDraftMeta();
const completedDraft = makeDraftMeta({
  draftId: COMPLETE_DRAFT_ID,
  status: "complete",
  rounds: 2,
  name: "Completed 12-Team Fixture"
});
const practiceDraft = makeDraftMeta({
  draftId: PRACTICE_DRAFT_ID,
  status: "pre_draft",
  name: "Practice Fixture"
});

const league = {
  league_id: LEAGUE_ID,
  draft_id: LIVE_DRAFT_ID,
  name: "Fixture League",
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"],
  scoring_settings: { rec: 1 }
};

function clone(value) {
  return structuredClone(value);
}

export async function installSleeperFixture(page, {
  draftId = LIVE_DRAFT_ID,
  status = "drafting",
  rounds = status === "complete" ? 2 : 15,
  picks = status === "complete"
    ? Array.from({ length: 24 }, (_, index) => makePick(index + 1, draftId))
    : []
} = {}) {
  const state = {
    draftId,
    status,
    rounds,
    picks: clone(picks)
  };

  await page.route("https://api.sleeper.app/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const currentMeta = makeDraftMeta({
      draftId: state.draftId,
      status: state.status,
      rounds: state.rounds,
      name: state.status === "complete" ? "Completed 12-Team Fixture" : "Live 12-Team Fixture"
    });
    currentMeta.last_picked = state.picks.length
      ? FIXED_TIME + state.picks.length * 60_000
      : null;

    let body;
    if (path === `/v1/draft/${state.draftId}/picks`) body = state.picks;
    else if (path === `/v1/draft/${state.draftId}/traded_picks`) body = [];
    else if (path === `/v1/draft/${state.draftId}`) body = currentMeta;
    else if (path === "/v1/players/nfl") body = players;
    else if (path.includes("/players/nfl/research/")) body = adp;
    else if (path === `/v1/league/${LEAGUE_ID}/rosters`) body = rosters;
    else if (path === `/v1/league/${LEAGUE_ID}/users`) body = owners;
    else if (path === `/v1/league/${LEAGUE_ID}`) body = league;
    else if (path === `/v1/league/${LEAGUE_ID}/drafts`) body = [liveDraft, completedDraft, practiceDraft];
    else if (path === "/v1/user/fixture-manager") {
      body = { user_id: "fixture-manager-id", username: "fixture-manager", display_name: "Fixture Manager" };
    } else if (path.startsWith("/v1/user/fixture-manager-id/drafts/nfl/")) body = [];
    else if (path.startsWith("/v1/user/fixture-manager-id/leagues/nfl/")) body = [league];
    else {
      const owner = owners.find((candidate) => path === `/v1/user/${candidate.user_id}`);
      if (owner) body = owner;
    }

    if (body === undefined) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: `Unhandled fixture path: ${path}` }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.route("https://sleepercdn.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+9an8WQAAAABJRU5ErkJggg==", "base64")
  }));

  return state;
}

export function monitorBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}
