import { describe, expect, it } from "vitest";
import { extractDraftId } from "../../src/draft-input.js";

describe("extractDraftId", () => {
  it("keeps a bare Sleeper draft ID", () => {
    expect(extractDraftId("12345678901234567")).toBe("12345678901234567");
  });

  it("extracts a draft ID from a Sleeper draft or mock link", () => {
    expect(extractDraftId("https://sleeper.com/draft/nfl/12345678901234567")).toBe("12345678901234567");
    expect(extractDraftId("sleeper://draft/32345678901234567?source=mock")).toBe("32345678901234567");
  });

  it("returns unrecognized input so validation can report it", () => {
    expect(extractDraftId("not-a-draft")).toBe("not-a-draft");
  });
});
