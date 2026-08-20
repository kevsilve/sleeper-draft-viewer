export const MOTION_MODE_FULL = "full";
export const MOTION_MODE_REDUCED = "reduced";
export const MOTION_MODE_AUTO = "auto";
export const MOTION_MODES = [MOTION_MODE_FULL, MOTION_MODE_REDUCED, MOTION_MODE_AUTO];

export function isMotionMode(value) {
  return MOTION_MODES.includes(value);
}

export function defaultMotionMode(prefersReducedMotion) {
  return prefersReducedMotion ? MOTION_MODE_REDUCED : MOTION_MODE_FULL;
}

export function effectiveMotionMode(selectedMode, autoDegraded = false) {
  if (selectedMode === MOTION_MODE_REDUCED) return MOTION_MODE_REDUCED;
  if (selectedMode === MOTION_MODE_AUTO && autoDegraded) return MOTION_MODE_REDUCED;
  return MOTION_MODE_FULL;
}

export function createAutoMotionMonitor({
  minimumFps = 45,
  sampleSize = 30,
  sustainedWindows = 3
} = {}) {
  let samples = [];
  let consecutivePoorWindows = 0;
  let degraded = false;

  function reset() {
    samples = [];
    consecutivePoorWindows = 0;
    degraded = false;
  }

  function recordFrame(delta) {
    if (degraded || !Number.isFinite(delta) || delta <= 0 || delta >= 250) return null;
    samples.push(delta);
    if (samples.length < sampleSize) return null;

    const window = samples.splice(0, sampleSize);
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const fps = Math.round(1000 / average);
    consecutivePoorWindows = fps < minimumFps ? consecutivePoorWindows + 1 : 0;
    degraded = consecutivePoorWindows >= sustainedWindows;
    return { degraded, fps, poorWindows: consecutivePoorWindows };
  }

  return {
    isDegraded: () => degraded,
    recordFrame,
    reset
  };
}
