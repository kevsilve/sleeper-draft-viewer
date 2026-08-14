import { expect, test } from "@playwright/test";
import {
  COMPLETE_DRAFT_ID,
  LIVE_DRAFT_ID,
  installSleeperFixture,
  makePick,
  monitorBrowserErrors
} from "./fixtures/sleeper.js";

test("discovers deterministic drafts from the setup screen and connects", async ({ page }) => {
  const errors = monitorBrowserErrors(page);
  await installSleeperFixture(page);

  await page.goto("/");
  await expect(page.locator("#setupscreen")).toHaveClass(/show/);
  await page.locator("#usernameInput").fill("fixture-manager");
  await page.locator("#detectBtn").click();

  await expect(page.getByText("League Drafts (1)")).toBeVisible();
  await expect(page.getByText("Practice Drafts (2)")).toBeVisible();
  await page.locator(".draftcard", { hasText: LIVE_DRAFT_ID }).click();

  await expect(page).toHaveURL(new RegExp(`\\?draft=${LIVE_DRAFT_ID}$`));
  await expect(page.locator("#app")).toHaveClass(/ready/);
  expect(errors).toEqual([]);
});

test("renders an active 12-team production board from mocked Sleeper data", async ({ page }) => {
  const errors = monitorBrowserErrors(page);
  await installSleeperFixture(page, { picks: [makePick(1), makePick(2)] });

  await page.goto(`/?draft=${LIVE_DRAFT_ID}`);
  await expect(page.locator("#app")).toHaveClass(/ready/);
  await expect(page.locator("#grid .gcell.header")).toHaveCount(13);
  await expect(page.locator("#pickcounter")).toHaveText("Pick 3 of 180");
  await expect(page.locator("#onclockname")).toHaveText("Fixture Team 3");
  await expect(page.locator("#ticker .item", { hasText: "Fixture Player 2" })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("processes a rapid burst of picks once and in order", async ({ page }) => {
  const errors = monitorBrowserErrors(page);
  const state = await installSleeperFixture(page);

  await page.goto(`/?draft=${LIVE_DRAFT_ID}`);
  await expect(page.locator("#app")).toHaveClass(/ready/);

  state.picks = [1, 2, 3, 4].map((pickNo) => makePick(pickNo));

  await expect(page.locator("#ticker .item", { hasText: "Fixture Player 4" })).toHaveCount(1);
  await expect(page.locator("#ticker .item", { hasText: "Fixture Player 1" })).toHaveCount(1);
  await expect(page.locator("#pickcounter")).toHaveText("Pick 5 of 180");
  const tickerText = await page.locator("#ticker .item").allTextContents();
  expect(tickerText.slice(0, 4)).toEqual(expect.arrayContaining([
    expect.stringContaining("Fixture Player 1"),
    expect.stringContaining("Fixture Player 2"),
    expect.stringContaining("Fixture Player 3"),
    expect.stringContaining("Fixture Player 4")
  ]));
  expect(errors).toEqual([]);
});

test("renders the completed-draft recap from a terminal fixture", async ({ page }) => {
  const errors = monitorBrowserErrors(page);
  await installSleeperFixture(page, { draftId: COMPLETE_DRAFT_ID, status: "complete" });

  await page.goto(`/?draft=${COMPLETE_DRAFT_ID}`);
  await expect(page.locator("#app")).toHaveClass(/ready/);
  await expect(page.locator("#complete")).toHaveClass(/show/);
  await expect(page.getByRole("heading", { name: "DRAFT COMPLETE" })).toBeVisible();
  await expect(page.locator("#recapgrid .recapteam")).toHaveCount(12);
  expect(errors).toEqual([]);
});
