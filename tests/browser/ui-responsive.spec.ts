import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
const sizes = [
  [2560, 1440],
  [1920, 1080],
  [1440, 900],
  [1280, 800],
  [900, 1200],
  [800, 1280],
  [600, 960],
  [390, 844],
];
async function nav(page: Page, name: string) {
  if (
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function fits(page: Page) {
  expect(
    await page.locator("main").evaluate((e) => e.scrollWidth - e.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
test("academic hierarchy, portrait navigation, touch actions, calendar and dialogs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("University folder", { exact: true })
    .fill(path.resolve(".local/ui-e2e-files", String(Date.now())));
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await expect(page.getByRole("heading", { name: /Good / })).toBeVisible();
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await nav(page, "Dashboard");
    await fits(page);
    await page.screenshot({ path: `.local/ui-review/${width}-dashboard.png` });
    await expect(
      page.getByRole("heading", { name: "Your courses", exact: true }),
    ).toHaveCount(0);
    if (width <= 900) {
      const positions = await page
        .locator(
          ".next-exam,.dashboard-today,.dashboard-upcoming,.dashboard-assignments,.dashboard-files,.dashboard-progress",
        )
        .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      for (const name of [
        "View exam",
        "Set up preparation",
        "Start study session",
        "Open calendar",
      ]) {
        const box = await page
          .getByRole("button", { name, exact: true })
          .boundingBox();
        expect(box!.height, name).toBeGreaterThanOrEqual(44);
      }
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      const drawer = page.getByRole("dialog", {
        name: "Navigation",
        exact: true,
      });
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "Open navigation", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("button", { name: "Search workspace", exact: true })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Search UniDesk", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
    }
    for (const name of [
      "Courses",
      "Assignments",
      "Exams",
      "Grades",
      "Emails",
      "Degree Progress",
      "Calendar",
    ]) {
      await nav(page, name);
      await fits(page);
      await page.screenshot({
        path: `.local/ui-review/${width}-${name.replaceAll(" ", "-")}.png`,
      });
    }
    if (width <= 900)
      await expect(
        page.getByRole("button", { name: "Agenda", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page.screenshot({ path: `.local/ui-review/${width}-month.png` });
    if (width <= 900) {
      await page.locator(".day-event-count").first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await fits(page);
    await page.screenshot({ path: `.local/ui-review/${width}-week.png` });
    await nav(page, "Courses");
    await page
      .getByRole("button", { name: "Open PHIL 210", exact: true })
      .click();
    for (const section of [
      "Overview",
      "Materials",
      "Assessments",
      "Schedule",
      "Syllabus",
      "Emails",
      "Ask Course",
    ]) {
      await page
        .getByRole("navigation", { name: "Course sections" })
        .getByRole("button", { name: section, exact: true })
        .click();
      await fits(page);
      await page.screenshot({
        path: `.local/ui-review/${width}-course-${section.replaceAll(" ", "-")}.png`,
      });
    }
    await nav(page, "Dashboard");
    await page
      .getByRole("button", { name: "Set up preparation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Preparation", exact: true }),
    ).toHaveClass("selected");
    await fits(page);
  }
  await page.setViewportSize({ width: 800, height: 1280 });
  await nav(page, "Courses");
  await page
    .getByRole("button", { name: "Open PHIL 210", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Course sections" })
    .getByRole("button", { name: "Materials", exact: true })
    .click();
  await page.getByRole("button", { name: "Lectures", exact: true }).click();
  const row = page.locator(".file-table tbody > tr").filter({
    has: page.getByRole("button", { name: "Lecture 03", exact: false }),
  });
  await expect(row).toBeVisible();
  const cells = await row.locator(":scope > td").evaluateAll((es) =>
    es.slice(0, -1).map((e) => ({
      top: e.getBoundingClientRect().top,
      bottom: e.getBoundingClientRect().bottom,
    })),
  );
  cells
    .slice(1)
    .forEach((cell, i) =>
      expect(cell.top).toBeGreaterThanOrEqual(cells[i].bottom),
    );
  await page.getByRole("button", { name: "Edit course", exact: true }).click();
  await page.setViewportSize({ width: 800, height: 500 }); // Reduced visual viewport while typing.
  const dialog = page.getByRole("dialog", { name: "Edit course", exact: true });
  // The visualViewport resize handler updates the CSS bounds on the next frame.
  await expect
    .poll(async () => (await dialog.boundingBox())!.y)
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const box = (await dialog.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(500);
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeVisible();
  await nav(page, "Dashboard");
  await page
    .getByRole("button", { name: "Start study session", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Study timer", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("compact honest empty states and bounded email previews use persisted records", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Good / })).toBeVisible();
  const write = async (sql: string, params: unknown[] = []) => {
    const r = await page.request.post("/api/local", {
      headers: { "X-UniDesk-Local": "1" },
      data: { command: "batch", args: { statements: [{ sql, params }] } },
    });
    expect(r.ok()).toBeTruthy();
  };
  // This configuration owns an isolated test database; no workspace data is touched.
  await write("DELETE FROM assignments");
  await write(
    "INSERT INTO email_accounts(id,provider,email_address,client_id) VALUES('ui-account','microsoft','review@example.edu','test')",
  );
  for (let i = 0; i < 4; i++)
    await write(
      "INSERT INTO emails(id,account_id,provider_message_id,sender_name,sender_email,subject,received_at,requires_review) VALUES(?,?,?,?,?,?,?,1)",
      [
        `ui-email-${i}`,
        "ui-account",
        `message-${i}`,
        "Registrar",
        "registrar@example.edu",
        `Academic notice ${i}`,
        "2026-09-13T10:00:00Z",
      ],
    );
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Email needs attention (4)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".email-attention-row")).toHaveCount(2);
  await expect(
    page.getByText(
      "Track lectures, readings, or preparation items to see course progress.",
      { exact: true },
    ),
  ).toHaveCount(1);
  await expect(
    page.getByText("Not enough tracked items yet", { exact: true }),
  ).toHaveCount(0);
  expect(
    (await page.locator(".dashboard-assignments").boundingBox())!.height,
  ).toBeLessThan(140);
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await fits(page);
    await page.screenshot({
      path: `.local/ui-review/${width}-empty-and-email.png`,
      fullPage: true,
    });
    await nav(page, "Emails");
    await expect(page.locator(".email-row")).toHaveCount(4);
    await fits(page);
    await page.screenshot({
      path: `.local/ui-review/${width}-mail-populated.png`,
    });
    await nav(page, "Dashboard");
  }
  await page
    .getByRole("button", { name: "Set up tracking", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Add reading", exact: true }),
  ).toBeVisible();
});
