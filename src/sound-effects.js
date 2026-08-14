export function createSoundEffects(initiallyEnabled = true) {
  let muted = !initiallyEnabled;
  let audioCtx;
  let masterGain;

  function setEnabled(enabled) {
    muted = !enabled;
    if (!masterGain) return;
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.setTargetAtTime(muted ? 0 : 1, audioCtx.currentTime, 0.01);
  }

  function ensureAudio() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (!masterGain) {
      masterGain = audioCtx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  function playTone(freqs, opts = {}) {
    if (muted) return;
    const { type = "sine", gain = 0.22, spacing = 0.08, dur = 0.4 } = opts;
    try {
      const ctx = ensureAudio();
      const now = ctx.currentTime;
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(gain, now + 0.02 + i * spacing);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur + i * spacing);
        osc.connect(g).connect(masterGain);
        osc.start(now + i * spacing);
        osc.stop(now + dur + 0.1 + i * spacing);
      });
    } catch {}
  }

  const pickMotifs = {
    QB: [392, 587, 784], RB: [330, 440, 659], WR: [440, 659, 880],
    TE: [349, 523, 698], K: [494, 740, 988], DEF: [294, 392, 523]
  };

  function soundPickIncoming(pick) {
    const seed = Number(pick?.pick_no || 0) % 4;
    playTone([360 + seed * 24, 540 + seed * 30], { type: "sine", spacing: 0.045, dur: 0.22, gain: 0.16 });
  }

  function soundPickReveal(pick) {
    const motif = pickMotifs[(pick?.player?.position || "").toUpperCase()] || [392, 587, 784];
    const type = ["triangle", "sine", "sawtooth"][Number(pick?.pick_no || 0) % 3];
    playTone(motif, { type, spacing: 0.075, dur: 0.46, gain: type === "sawtooth" ? 0.11 : 0.18 });
  }

  function soundOnClock(clock) {
    const root = 610 + (Number(clock?.pick_no || 0) % 5) * 22;
    playTone([root], { type: "sine", dur: 0.16, gain: 0.12 });
  }

  function soundTrade() {
    playTone([520, 390], { type: "square", spacing: 0.1, dur: 0.3, gain: 0.12 });
  }

  function soundClockWarn() {
    playTone([880, 880], { type: "square", spacing: 0.14, dur: 0.12, gain: 0.16 });
  }

  return { setEnabled, soundClockWarn, soundOnClock, soundPickIncoming, soundPickReveal, soundTrade };
}
