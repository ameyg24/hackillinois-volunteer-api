import { test, expect } from "@playwright/test";

test("shows a real schedule on desktop and mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("Connected to the API");
  await expect(page.locator(".shift-card")).toHaveCount(6);
  await page
    .getByLabel("YOU’RE SIGNING UP AS")
    .selectOption({ label: "Sam Rivera · sam@example.com" });
  await expect(
    page.getByRole("button", { name: "Cancel signup", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "test-results/volunteer-board-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".shift-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/volunteer-board-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create a shift", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Close shift form" }).click();
  expect(errors).toEqual([]);
});

test("registers, creates, fills, cancels, edits, and deletes a shift", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("Connected to the API");
  const email = `tester-${Date.now()}@example.com`;
  await page.getByRole("button", { name: "Register a volunteer" }).click();
  await page.getByLabel("Full name").fill("Taylor Demo");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByRole("button", { name: "Register volunteer", exact: true })
    .click();
  await expect(page.locator("#volunteer-dialog")).not.toBeVisible();
  await expect(page.locator("#volunteer-select option:checked")).toContainText(
    "Taylor Demo",
  );
  const taylor = await page.locator("#volunteer-select").inputValue();

  await page
    .getByRole("button", { name: "Create a shift", exact: true })
    .click();
  await page.getByLabel("Shift title").fill("Browser test shift");
  await page.getByLabel("Location", { exact: true }).fill("Main hall");
  await page.getByLabel("Volunteer capacity").fill("1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create shift", exact: true })
    .click();
  const card = page
    .locator(".shift-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Browser test shift",
        exact: true,
      }),
    });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Join this shift" }).click();
  await expect(
    card.getByRole("button", { name: "Cancel signup" }),
  ).toBeVisible();
  await expect(card.locator("[role=meter]")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page.getByRole("button", { name: "My shifts" }).click();
  await expect(page.locator(".shift-card")).toHaveCount(1);

  await page.getByRole("button", { name: "All shifts" }).click();
  await page
    .locator("#volunteer-select")
    .selectOption({ label: "Alex Chen · alex@example.com" });
  await expect(card.getByRole("button", { name: "Shift full" })).toBeDisabled();
  await page.locator("#volunteer-select").selectOption(taylor);
  await card.getByRole("button", { name: "Cancel signup" }).click();
  await expect(
    card.getByRole("button", { name: "Join this shift" }),
  ).toBeEnabled();
  await page
    .locator("#volunteer-select")
    .selectOption({ label: "Alex Chen · alex@example.com" });
  await card.getByRole("button", { name: "Join this shift" }).click();
  await expect(
    card.getByRole("button", { name: "Cancel signup" }),
  ).toBeEnabled();
  await card.getByText("View the crew").click();
  await expect(card.locator("li")).toHaveText("Alex Chen");
  await page.reload();
  await expect(
    card.getByRole("button", { name: "Cancel signup" }),
  ).toBeEnabled();

  await card.getByRole("button", { name: "Edit Browser test shift" }).click();
  await expect(
    page.getByRole("button", { name: "Delete shift" }),
  ).toBeDisabled();
  await page.getByLabel("Location", { exact: true }).fill("West hall");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText("West hall")).toBeVisible();
  await card.getByRole("button", { name: "Cancel signup" }).click();
  await expect(
    card.getByRole("button", { name: "Join this shift" }),
  ).toBeEnabled();
  await card.getByRole("button", { name: "Edit Browser test shift" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete shift" }).click();
  await expect(card).toHaveCount(0);
});

test("shows API errors, searches safely, and recovers after a connection error", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("Connected to the API");
  await page.getByRole("button", { name: "Register a volunteer" }).click();
  await page.getByLabel("Full name").fill("Someone else");
  await page.getByLabel("Email address").fill("sam@example.com");
  await page
    .getByRole("button", { name: "Register volunteer", exact: true })
    .click();
  await expect(page.locator("#volunteer-form [role=alert]")).toHaveText(
    "Email is already registered",
  );
  await page.getByRole("button", { name: "Close registration" }).click();
  await page.getByRole("searchbox").fill("no such shift");
  await expect(
    page.getByRole("heading", { name: "No matching shifts" }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("welcome desk");
  await expect(page.locator(".shift-card")).toHaveCount(1);
  await page.route("**/health", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh shifts" }).click();
  await expect(page.locator("#load-error")).toContainText(
    "Could not reach the server",
  );
  await page.unroute("**/health");
  await page.getByRole("button", { name: "Refresh shifts" }).click();
  await expect(page.locator("#load-error")).not.toBeVisible();
  await expect(page.locator("#connection")).toHaveText("Connected to the API");
});
