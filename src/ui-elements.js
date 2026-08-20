const setupscreen = document.getElementById("setupscreen");
const usernameInput = document.getElementById("usernameInput");
const detectBtn = document.getElementById("detectBtn");
const draftlist = document.getElementById("draftlist");
const draftIdInput = document.getElementById("draftIdInput");
const connectBtn = document.getElementById("connectBtn");
const setupErr = document.getElementById("setupErr");

const appEl = document.getElementById("app");
const spotlight = document.getElementById("spotlight");
const gridview = document.getElementById("gridview");
const teamview = document.getElementById("teamview");
const teamgrid = document.getElementById("teamgrid");
const grid = document.getElementById("grid");
const card = document.getElementById("card");
const pickribbon = document.getElementById("pickribbon");
const draftedby = document.getElementById("draftedby");
const logopattern = document.getElementById("logopattern");
const skiphint = document.getElementById("skiphint");
const onclockname = document.getElementById("onclockname");
const onclockowner = document.getElementById("onclockowner");
const onclockavatar = document.getElementById("onclockavatar");
const pickcounter = document.getElementById("pickcounter");
const roundcounter = document.getElementById("roundcounter");
const timertext = document.getElementById("timertext");
const timerfg = document.getElementById("timerfg");
const timerwrap = document.getElementById("timerwrap");
const reconnectbanner = document.getElementById("reconnectbanner");
const ticker = document.getElementById("ticker");
const soundbtn = document.getElementById("soundbtn");
const fsbtn = document.getElementById("fsbtn");
const gridbtn = document.getElementById("gridbtn");
const teamsbtn = document.getElementById("teamsbtn");
const zoombtn = document.getElementById("zoombtn");
const settingsbtn = document.getElementById("settingsbtn");
const changebtn = document.getElementById("changebtn");
const settingspanel = document.getElementById("settingspanel");
const settingsclose = document.getElementById("settingsclose");
const mockModeToggle = document.getElementById("mockModeToggle");
const teamBuildToggle = document.getElementById("teamBuildToggle");
const settingsSoundToggle = document.getElementById("settingsSoundToggle");
const motionModeButtons = [...document.querySelectorAll("[data-motion-mode]")];
const replayRevealBtn = document.getElementById("replayRevealBtn");
const modeStatusText = document.getElementById("modeStatusText");
const performanceStatusText = document.getElementById("performanceStatusText");
const performanceReadout = document.querySelector(".performance-readout");
const transitionveil = document.getElementById("transitionveil");
const controls = document.getElementById("controls");
const tradebanner = document.getElementById("tradebanner");
const completeOverlay = document.getElementById("complete");
const recapgrid = document.getElementById("recapgrid");
const recapawards = document.getElementById("recapawards");
const recapTeamsBtn = document.getElementById("recapTeamsBtn");
const recapLineupsBtn = document.getElementById("recapLineupsBtn");
const recapBoardBtn = document.getElementById("recapBoardBtn");
const recapZoomBtn = document.getElementById("recapZoomBtn");

export {
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
  motionModeButtons,
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
};
