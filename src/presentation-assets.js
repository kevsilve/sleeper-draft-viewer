const POS_COLORS = { QB: "var(--qb)", RB: "var(--rb)", WR: "var(--wr)", TE: "var(--te)", K: "var(--k)", DEF: "var(--def)" };
const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "FLEX"];
// hex versions for building the glow/ring CSS vars behind the reveal card
const POS_HEX = { QB: "#e74c3c", RB: "#2ecc71", WR: "#3498db", TE: "#e67e22", K: "#9b59b6", DEF: "#7f8c8d" };
const TEAM_COLORS = {
  ARI: ["#97233f", "#ffb612"], ATL: ["#a71930", "#000000"], BAL: ["#241773", "#9e7c0c"],
  BUF: ["#00338d", "#c60c30"], CAR: ["#0085ca", "#101820"], CHI: ["#0b162a", "#c83803"],
  CIN: ["#fb4f14", "#000000"], CLE: ["#311d00", "#ff3c00"], DAL: ["#003594", "#869397"],
  DEN: ["#fb4f14", "#002244"], DET: ["#0076b6", "#b0b7bc"], GB: ["#203731", "#ffb612"],
  HOU: ["#03202f", "#a71930"], IND: ["#002c5f", "#a2aaad"], JAX: ["#006778", "#d7a22a"],
  KC: ["#e31837", "#ffb81c"], LV: ["#000000", "#a5acaf"], LAC: ["#0080c6", "#ffc20e"],
  LAR: ["#003594", "#ffa300"], MIA: ["#008e97", "#fc4c02"], MIN: ["#4f2683", "#ffc62f"],
  NE: ["#002244", "#c60c30"], NO: ["#d3bc8d", "#101820"], NYG: ["#0b2265", "#a71930"],
  NYJ: ["#125740", "#ffffff"], PHI: ["#004c54", "#a5acaf"], PIT: ["#ffb612", "#101820"],
  SEA: ["#002244", "#69be28"], SF: ["#aa0000", "#b3995d"], TB: ["#d50a0a", "#ff7900"],
  TEN: ["#0c2340", "#4b92db"], WAS: ["#5a1414", "#ffb612"]
};
function teamTheme(teamAbbr) {
  const [primary, secondary] = TEAM_COLORS[(teamAbbr || "").toUpperCase()] || ["#ffcc33", "#5ec8ff"];
  const primaryText = readableTeamAccent(primary, secondary);
  const secondaryText = readableTeamAccent(secondary, primary);
  return {
    primary,
    secondary,
    primaryText,
    secondaryText,
    secondaryInk: textOnColor(secondary),
    glow: hexToRgba(primary, 0.42),
    soft: hexToRgba(secondary, 0.28)
  };
}
// ESPN hosts clean team logo PNGs at a predictable public URL keyed by lowercase
// team abbreviation. Sleeper's abbreviations match ESPN's for every team except
// Washington (Sleeper: WAS, ESPN: wsh).
const TEAM_LOGO_OVERRIDES = { WAS: "wsh" };
function teamLogoUrl(teamAbbr) {
  if (!teamAbbr) return null;
  const code = TEAM_LOGO_OVERRIDES[teamAbbr.toUpperCase()] || teamAbbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`;
}
const teamLogoCache = new Map();
const playerImageCache = new Map();
const NFL_TEAM_CODES = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"];
function preloadTeamLogo(teamAbbr) {
  const key = (teamAbbr || "").toUpperCase();
  if (!key || teamLogoCache.has(key)) return teamLogoCache.get(key) || null;
  const img = new Image();
  img.decoding = "async";
  img.src = teamLogoUrl(key);
  teamLogoCache.set(key, img);
  return img;
}
function preloadAllTeamLogos() {
  NFL_TEAM_CODES.forEach((team, i) => {
    setTimeout(() => preloadTeamLogo(team), i * 60);
  });
}
if ("requestIdleCallback" in window) {
  requestIdleCallback(preloadAllTeamLogos, { timeout: 2500 });
} else {
  setTimeout(preloadAllTeamLogos, 1200);
}
function playerHeadshotUrl(playerId) {
  return playerId ? `https://sleepercdn.com/content/nfl/players/${playerId}.jpg` : null;
}
function preloadHeadshot(playerId) {
  const key = String(playerId || "");
  if (!key || playerImageCache.has(key)) return playerImageCache.get(key) || null;
  const img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  img.src = playerHeadshotUrl(key);
  playerImageCache.set(key, img);
  return img;
}
function primePickAssets(picks) {
  (picks || []).slice(-18).forEach((pick) => {
    preloadHeadshot(pick?.player?.id);
    preloadTeamLogo(pick?.player?.team);
  });
}
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function relativeLuminance(hex) {
  const { r, g, b } = hexRgb(hex);
  return [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function readableTeamAccent(color, fallback) {
  const darkPanel = "#060a14";
  if (contrastRatio(color, darkPanel) >= 3.4) return color;
  if (fallback && contrastRatio(fallback, darkPanel) >= 3.4) return fallback;
  return "#f4f6fb";
}
function textOnColor(hex) {
  return contrastRatio(hex, "#06090f") >= 4.5 ? "#06090f" : "#f4f6fb";
}

export { POS_COLORS, POS_ORDER, POS_HEX, hexToRgba, teamTheme, teamLogoUrl, preloadTeamLogo, preloadHeadshot, primePickAssets };
