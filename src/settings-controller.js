const SETTINGS_KEY = "draft-viewer-broadcast-settings-v1";

export function createSettingsController({
  getPickCount,
  modeStatusText,
  mockModeToggle,
  onMockModeEnabled,
  onReplayLatest,
  onSoundChange,
  replayRevealBtn,
  settingsbtn,
  settingsclose,
  settingspanel,
  settingsSoundToggle,
  teamBuildToggle
}) {
  const settings = { mockDraftMode: false, showTeamBuild: true, soundEnabled: true };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved && typeof saved === "object") {
      for (const key of Object.keys(settings)) {
        if (typeof saved[key] === "boolean") settings[key] = saved[key];
      }
    }
  } catch {}

  function save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }

  function render() {
    document.body.classList.toggle("mock-mode", settings.mockDraftMode);
    mockModeToggle.setAttribute("aria-checked", String(settings.mockDraftMode));
    teamBuildToggle.setAttribute("aria-checked", String(settings.showTeamBuild));
    settingsSoundToggle.setAttribute("aria-checked", String(settings.soundEnabled));
    settingsbtn.textContent = settings.mockDraftMode ? "⚡ Mock" : "⚙ Live";
    settingsbtn.classList.toggle("active", settingspanel.classList.contains("show"));
    replayRevealBtn.disabled = getPickCount() === 0;
    modeStatusText.textContent = settings.mockDraftMode
      ? "Mock mode · rapid-pick catch-up enabled"
      : "Full broadcast timing · every reveal plays";
  }

  function togglePanel(show = !settingspanel.classList.contains("show")) {
    settingspanel.classList.toggle("show", show);
    settingspanel.setAttribute("aria-hidden", String(!show));
    render();
  }

  function setSoundEnabled(enabled) {
    settings.soundEnabled = !!enabled;
    save();
    render();
    onSoundChange(settings.soundEnabled);
  }

  settingsbtn.onclick = (event) => { event.stopPropagation(); togglePanel(); };
  settingsclose.onclick = () => togglePanel(false);
  settingspanel.onclick = (event) => event.stopPropagation();
  document.addEventListener("click", () => togglePanel(false));
  mockModeToggle.onclick = () => {
    settings.mockDraftMode = !settings.mockDraftMode;
    if (settings.mockDraftMode) onMockModeEnabled();
    save();
    render();
  };
  teamBuildToggle.onclick = () => {
    settings.showTeamBuild = !settings.showTeamBuild;
    save();
    render();
  };
  settingsSoundToggle.onclick = () => setSoundEnabled(!settings.soundEnabled);
  replayRevealBtn.onclick = () => {
    togglePanel(false);
    onReplayLatest();
  };

  render();
  return { render, save, settings, togglePanel };
}
