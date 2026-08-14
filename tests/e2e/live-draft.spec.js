import { expect, test } from "@playwright/test";

const draftId = "12345678901234567";

function draftMeta(status = "drafting") {
  return {
    draft_id: draftId,
    league_id: null,
    status,
    season: "2026",
    start_time: Date.now(),
    last_picked: null,
    draft_order: {},
    settings: { teams: 12, rounds: 15, pick_timer: 120 },
    metadata: { name: "Test Draft", scoring_type: "ppr" }
  };
}

test("loads a selected draft and reveals a newly polled pick exactly once", async ({ page }) => {
  let picks = [];

  await page.route("https://api.sleeper.app/**", async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname.endsWith(`/draft/${draftId}/picks`)) body = picks;
    else if (url.pathname.endsWith(`/draft/${draftId}/traded_picks`)) body = [];
    else if (url.pathname.endsWith(`/draft/${draftId}`)) body = draftMeta();
    else if (url.pathname.includes("/players/nfl/research/")) body = {};
    else if (url.pathname.endsWith("/players/nfl")) body = {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`/?draft=${draftId}`);
  await expect(page.locator("#app")).toHaveClass(/ready/);

  picks = [{
    draft_id: draftId,
    player_id: "9999",
    picked_by: "owner-1",
    roster_id: 1,
    round: 1,
    draft_slot: 1,
    pick_no: 1,
    metadata: { first_name: "Test", last_name: "Runner", position: "RB", team: "BUF" }
  }];

  await expect(page.getByText("Test Runner").first()).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#ticker .item", { hasText: "Test Runner" })).toHaveCount(1);
});

test("shows setup and rejects an invalid pasted draft", async ({ page }) => {
  await page.route("https://api.sleeper.app/**", (route) => route.fulfill({
    status: 404,
    contentType: "application/json",
    body: "null"
  }));

  await page.goto("/");
  await expect(page.locator("#setupscreen")).toHaveClass(/show/);
  await page.locator("#draftIdInput").fill("https://sleeper.com/draft/nfl/12345678901234567");
  await page.locator("#connectBtn").click();
  await expect(page.locator("#setupErr")).toContainText(/404|Draft not found/);
});
