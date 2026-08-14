import { describe, expect, it } from "vitest";
import { normalizePlayerName, slotForPick } from "../../src/draft-engine.js";

describe("slotForPick", () => {
  it("calculates alternating snake-draft slots", () => {
    expect(slotForPick(1, 12)).toEqual({ round: 1, slot: 1 });
    expect(slotForPick(12, 12)).toEqual({ round: 1, slot: 12 });
    expect(slotForPick(13, 12)).toEqual({ round: 2, slot: 12 });
    expect(slotForPick(24, 12)).toEqual({ round: 2, slot: 1 });
    expect(slotForPick(25, 12)).toEqual({ round: 3, slot: 1 });
  });
});

describe("normalizePlayerName", () => {
  it("normalizes suffixes, punctuation, whitespace, and accents", () => {
    expect(normalizePlayerName("  Odell Beckham Jr. ")).toBe("odell beckham");
    expect(normalizePlayerName("D'Andre  Swift")).toBe("dandre swift");
    expect(normalizePlayerName("José Núñez III")).toBe("jose nunez");
  });
});
