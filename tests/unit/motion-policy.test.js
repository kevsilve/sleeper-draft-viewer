import { describe, expect, it } from "vitest";
import {
  createAutoMotionMonitor,
  defaultMotionMode,
  effectiveMotionMode
} from "../../src/motion-policy.js";

describe("motion policy", () => {
  it("defaults to full unless the OS requests reduced motion", () => {
    expect(defaultMotionMode(false)).toBe("full");
    expect(defaultMotionMode(true)).toBe("reduced");
  });

  it("never degrades Full from an Auto signal", () => {
    expect(effectiveMotionMode("full", true)).toBe("full");
    expect(effectiveMotionMode("reduced", false)).toBe("reduced");
    expect(effectiveMotionMode("auto", true)).toBe("reduced");
  });

  it("degrades Auto only after sustained measured poor frame windows", () => {
    const monitor = createAutoMotionMonitor({ minimumFps: 45, sampleSize: 4, sustainedWindows: 3 });
    const slowWindow = () => Array.from({ length: 4 }, () => monitor.recordFrame(30)).at(-1);

    expect(slowWindow()).toMatchObject({ degraded: false, poorWindows: 1 });
    expect(slowWindow()).toMatchObject({ degraded: false, poorWindows: 2 });
    expect(slowWindow()).toMatchObject({ degraded: true, poorWindows: 3 });
  });

  it("requires poor windows to be consecutive", () => {
    const monitor = createAutoMotionMonitor({ minimumFps: 45, sampleSize: 2, sustainedWindows: 2 });
    monitor.recordFrame(30);
    expect(monitor.recordFrame(30)).toMatchObject({ poorWindows: 1 });
    monitor.recordFrame(16);
    expect(monitor.recordFrame(16)).toMatchObject({ poorWindows: 0 });
    monitor.recordFrame(30);
    expect(monitor.recordFrame(30)).toMatchObject({ degraded: false, poorWindows: 1 });
  });
});
