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

test("keeps every reveal layer animated in Full mode on simulated 4-core and 4 GB hardware", async ({ page }) => {
  const errors = monitorBrowserErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 4 });
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 4 });
    localStorage.setItem("draft-viewer-broadcast-settings-v2", JSON.stringify({
      mockDraftMode: false,
      motionMode: "full",
      showTeamBuild: true,
      soundEnabled: false
    }));
  });
  const state = await installSleeperFixture(page);

  await page.goto(`/?draft=${LIVE_DRAFT_ID}`);
  await expect(page.locator("body")).toHaveAttribute("data-motion-mode", "full");
  await expect(page.locator("body")).toHaveAttribute("data-motion-effective", "full");
  state.picks = [makePick(1)];

  await expect(page.locator("#headshot.reveal")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#transitionveil")).toHaveClass(/active/);
  const motion = await page.evaluate(() => ({
    beams: getComputedStyle(document.querySelector("#beams")).animationName,
    orbit: getComputedStyle(document.querySelector("#orbit1")).animationName,
    pulse: getComputedStyle(document.querySelector("#pulsering")).animationName,
    transition: getComputedStyle(document.querySelector("#transitionveil")).animationName
  }));

  expect(motion.beams).toContain("beamBreathe");
  expect(motion.orbit).toContain("orbitCW");
  expect(motion.pulse).toContain("ringPulse");
  expect(motion.transition).toContain("revealHandoff");
  expect(errors).toEqual([]);
});

test("shows the complete final reveal state when Reduced motion is selected", async ({ page }) => {
  const errors = monitorBrowserErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await installSleeperFixture(page);

  await page.goto(`/?draft=${LIVE_DRAFT_ID}`);
  await expect(page.locator("body")).toHaveAttribute("data-motion-mode", "reduced");
  await expect(page.locator("body")).toHaveAttribute("data-motion-effective", "reduced");
  state.picks = [makePick(1)];

  await expect(page.locator("#playername.reveal")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("#headshot.reveal")).toBeVisible();
  await expect(page.locator("#draftedby.reveal")).toBeVisible();
  await expect(page.locator("#beams.reveal")).toBeVisible();
  await expect(page.locator("#pulsering.reveal")).toBeVisible();
  await expect(page.locator(".orbit.reveal")).toHaveCount(3);
  await expect(page.locator(".orbit.reveal").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("persists an explicit motion choice across reloads", async ({ page }) => {
  await installSleeperFixture(page);
  await page.goto(`/?draft=${LIVE_DRAFT_ID}`);

  await page.locator("#settingsbtn").click();
  await page.getByRole("radio", { name: "Auto" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-motion-mode", "auto");
  await page.reload();

  await expect(page.locator("body")).toHaveAttribute("data-motion-mode", "auto");
  await page.locator("#settingsbtn").click();
  await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
});
