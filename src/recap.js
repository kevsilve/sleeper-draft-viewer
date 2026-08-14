export function createRecap({
  POS_COLORS,
  ZOOM_LEVELS,
  burstReveal,
  canvas,
  completeOverlay,
  deferRecap,
  escapeHtml,
  getState,
  gridCellFlags,
  headerCellHtml,
  isRevealPending,
  pickNoForRoundSlot,
  pickPosition,
  recapBoardBtn,
  recapLineupsBtn,
  recapTeamsBtn,
  recapZoomBtn,
  recapawards,
  recapgrid,
  setAllPicks,
  synergyForPick
}) {
  let allPicks = [];
  let teamsOrder = [];
  let currentTeams = 12;
  let currentRounds = null;
  let leagueContext = {};
  let recapMode = "teams";
  let recapZoomIndex = 0;
  let recapCelebrated = false;

  function syncState() {
    ({ allPicks, teamsOrder, currentTeams, currentRounds, leagueContext } = getState());
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
    if (isRevealPending()) {
      deferRecap(picks);
      return;
    }
    completeOverlay.classList.add("show");
    allPicks = picks;
    setAllPicks(picks);
    recapMode = "teams";
    recapZoomBtn.textContent = `Zoom ${Math.round(ZOOM_LEVELS[recapZoomIndex] * 100)}%`;
    renderRecap();
    if (!recapCelebrated) {
      recapCelebrated = true;
      burstReveal("#ffcc33", canvas.height * 0.28);
    }
  }

  const withState = (fn) => (...args) => {
    syncState();
    return fn(...args);
  };
  recapTeamsBtn.onclick = withState(() => { recapMode = "teams"; renderRecap(); });
  recapLineupsBtn.onclick = withState(() => { recapMode = "lineups"; renderRecap(); });
  recapBoardBtn.onclick = withState(() => { recapMode = "board"; renderRecap(); });
  recapZoomBtn.onclick = withState(() => {
    recapZoomIndex = (recapZoomIndex + 1) % ZOOM_LEVELS.length;
    recapZoomBtn.textContent = "Zoom " + Math.round(ZOOM_LEVELS[recapZoomIndex] * 100) + "%";
    renderRecap();
  });

  return {
    leagueFormat: withState(leagueFormat),
    lineupCoverage: withState(lineupCoverage),
    renderRecap: withState(renderRecap),
    showRecap: withState(showRecap)
  };
}
