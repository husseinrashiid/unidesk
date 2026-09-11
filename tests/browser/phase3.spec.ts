import { test, expect } from "@playwright/test";
import path from "node:path";
test("1440p scaling, safe email review, search, cache clearing and persistence", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sql = async (statement: string, params: unknown[] = []) => {
    const response = await page.request.post("/api/local", {
      headers: { "X-UniDesk-Local": "1" },
      data: { command: "query", args: { sql: statement, params } },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).value;
  };
  const write = async (statements: { sql: string; params?: unknown[] }[]) => {
    const response = await page.request.post("/api/local", {
      headers: { "X-UniDesk-Local": "1" },
      data: { command: "batch", args: { statements } },
    });
    expect(response.ok()).toBeTruthy();
  };
  const nav = (name: string) =>
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name, exact: true });
  await page.goto("/");
  await page
    .getByLabel("University folder", { exact: true })
    .fill(path.resolve(".local/phase3-e2e-files", String(Date.now())));
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await expect(nav("Emails")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Number(document.documentElement.style.zoom)),
    )
    .toBe(1.5);
  await page.screenshot({ path: ".local/review/phase3-1440p-dashboard.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Interface size", { exact: true })).toHaveValue(
    "auto",
  );
  await page.getByLabel("Interface size", { exact: true }).selectOption("125");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.zoom))
    .toBe("1.25");
  await page.reload();
  await expect(nav("Emails")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.zoom))
    .toBe("1.25");
  await page.keyboard.press("Control+=");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.zoom))
    .toBe("1.5");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const course = (await sql("SELECT id FROM courses WHERE code='PHIL 210'"))[0]
    .id;
  await write([
    {
      sql: "INSERT INTO email_accounts(id,provider,email_address,client_id) VALUES('fixture','microsoft','student@example.edu','test-only')",
    },
    {
      sql: "INSERT INTO assignments(id,course_id,title,due_date,due_time,notes) VALUES('email-a',?,'Assignment 2','2026-09-11','23:59','Retain notes')",
      params: [course],
    },
    {
      sql: "INSERT INTO emails(id,account_id,provider_message_id,sender_email,subject,body_text,snippet,received_at,importance,requires_review) VALUES('fixture-mail','fixture','message','prof@example.edu','PHIL210 Assignment 2 deadline',?,?,'2026-09-06T10:00:00Z','Important',1)",
      params: [
        'Assignment 2 is now due September 14 instead of September 11.\n<img src="https://invalid.example/tracker" onerror="alert(1)">',
        "Assignment 2 deadline extended.",
      ],
    },
  ]);
  await nav("Emails").click();
  await page
    .getByRole("button")
    .filter({ hasText: "PHIL210 Assignment 2 deadline" })
    .click();
  await page.getByRole("button", { name: "Reanalyze", exact: true }).click();
  await expect(page.getByLabel("Proposed date", { exact: true })).toHaveValue(
    "2026-09-14",
  );
  await expect(page.getByLabel("Existing academic record")).toHaveValue(
    "email-a",
  );
  await expect(page.locator(".email-body img")).toHaveCount(0);
  await page.screenshot({ path: ".local/review/phase3-email-review-dark.png" });
  await page.getByRole("button", { name: "Apply reviewed change" }).click();
  await expect(
    page.getByText("Deadline change · Applied", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await sql(
        "SELECT due_date,due_time,notes FROM assignments WHERE id='email-a'",
      )
    )[0],
  ).toEqual({
    due_date: "2026-09-14",
    due_time: "23:59",
    notes: "Retain notes",
  });
  await page.getByRole("button", { name: "Reanalyze", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply reviewed change" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to emails" }).click();
  await page.getByLabel("Search email", { exact: true }).fill("September");
  await expect(page.locator(".email-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await nav("Emails").click();
  await page.screenshot({ path: ".local/review/phase3-email-list-light.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Clear cached email…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear cache", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect((await sql("SELECT count(*) n FROM emails"))[0].n).toBe(0);
  expect(
    (await sql("SELECT due_date FROM assignments WHERE id='email-a'"))[0]
      .due_date,
  ).toBe("2026-09-14");
  expect(
    (
      await sql(
        "SELECT source_sender,source_email_id FROM academic_change_log WHERE entity_id='email-a'",
      )
    )[0],
  ).toEqual({ source_sender: "prof@example.edu", source_email_id: null });
  await page.getByLabel("Interface size").selectOption("200");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+0");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.zoom))
    .toBe("1");
  expect(errors).toEqual([]);
});
