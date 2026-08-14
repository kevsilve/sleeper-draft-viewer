export function bindGlobalControls({
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
}) {
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

  document.addEventListener("keydown", (event) => {
    if (event.target === usernameInput || event.target === draftIdInput) return;
    if (event.key === "Escape" && settingspanel.classList.contains("show")) {
      toggleSettingsPanel(false);
    } else if (event.key === "ArrowRight" || event.code === "Space") {
      event.preventDefault();
      skipReveal();
    } else if (event.key.toLowerCase() === "g") {
      if (completeOverlay.classList.contains("show")) recapBoardBtn.click();
      else setViewMode("grid");
    } else if (event.key.toLowerCase() === "t") {
      if (completeOverlay.classList.contains("show")) recapTeamsBtn.click();
      else setViewMode("teams");
    } else if (event.key.toLowerCase() === "l") {
      if (completeOverlay.classList.contains("show")) recapLineupsBtn.click();
    } else if (event.key.toLowerCase() === "z") {
      if (completeOverlay.classList.contains("show")) recapZoomBtn.click();
      else zoombtn.click();
    } else if (event.key.toLowerCase() === "f") {
      fsbtn.click();
    } else if (event.key.toLowerCase() === "m") {
      soundbtn.click();
    }
  });

  teamsbtn.setAttribute("aria-keyshortcuts", "T");
}
