import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
test("complete local workspace flow and visual review", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const folder = path.resolve(".local/e2e-files", String(Date.now()));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to UniDesk" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "University folder", exact: true })
    .fill(folder);
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await expect(
    page.getByRole("heading", { name: "Good", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Midterm Exam", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/review/dashboard-light.png" });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Courses", exact: true })
    .click();
  await page.screenshot({ path: ".local/review/courses.png" });
  await page
    .getByRole("button", { name: "Add course", exact: true })
    .last()
    .click();
  await page
    .getByRole("textbox", { name: "Course code", exact: true })
    .fill("TEST 101");
  await page
    .getByRole("textbox", { name: "Course name", exact: true })
    .fill("Persistence & Local Files");
  await page.getByRole("button", { name: "Add meeting" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add course", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "TEST 101" })).toBeVisible();
  expect(
    fs.existsSync(path.join(folder, "Fall 2026/TEST101/Lectures")),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Open TEST 101", exact: true })
    .click();
  await page.getByRole("button", { name: "Materials", exact: true }).click();
  await page.getByRole("button", { name: "Lectures", exact: true }).click();
  const file = {
    name: "Lecture 01.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Academic material that must remain on disk."),
  };
  await page.locator("input[type=file]").setInputFiles(file);
  await expect(
    page.getByRole("button", { name: "Lecture 01.txt", exact: true }),
  ).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(file);
  await expect(
    page.getByRole("dialog", { name: "A file with this name already exists" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep both" }).click();
  await expect(
    page.getByRole("button", { name: "Lecture 01 (2).txt", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Actions for Lecture 01.txt", { exact: true }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "File name", exact: true })
    .fill("Lecture renamed.txt");
  await page.getByRole("button", { name: "Rename file", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lecture renamed.txt", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/review/course-files.png" });
  await page
    .getByLabel("Actions for Lecture renamed.txt", { exact: true })
    .click();
  await page.getByRole("button", { name: "Move…", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Readings");
  await page.getByRole("button", { name: "Move file", exact: true }).click();
  await page.getByRole("button", { name: "Readings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lecture renamed.txt", exact: true }),
  ).toBeVisible();
  expect(
    fs.readFileSync(
      path.join(folder, "Fall 2026/TEST101/Readings/Lecture renamed.txt"),
      "utf8",
    ),
  ).toContain("Academic material");
  await page
    .getByLabel("Actions for Lecture renamed.txt", { exact: true })
    .click();
  await page.getByRole("button", { name: "Delete everywhere", exact: true }).click();
  await page.getByRole("button", { name: "Delete everywhere", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lecture renamed.txt", exact: true }),
  ).toHaveCount(0);
  expect(
    fs.existsSync(
      path.join(folder, "Fall 2026/TEST101/Readings/Lecture renamed.txt"),
    ),
  ).toBeTruthy();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Assignments", exact: false })
    .click();
  await page
    .getByRole("button", { name: "Add assignment", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Test assignment");
  await page
    .getByRole("combobox", { name: "Course", exact: true })
    .selectOption({ label: "TEST 101 · Persistence & Local Files" });
  await page.getByLabel("Due date", { exact: true }).fill("2026-10-02");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add assignment", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Test assignment", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Status for Test assignment" })
    .selectOption("Submitted");
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Test assignment", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await page.screenshot({ path: ".local/review/assignments.png" });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Exams", exact: true })
    .click();
  await page.screenshot({ path: ".local/review/exams.png" });
  await page
    .getByRole("button", { name: "Midterm Exam", exact: false })
    .click();
  await page.screenshot({ path: ".local/review/exam-detail.png" });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  await page.screenshot({ path: ".local/review/calendar-month.png" });
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.screenshot({ path: ".local/review/calendar-week.png" });
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.screenshot({ path: ".local/review/calendar-agenda.png" });
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search UniDesk", exact: true })
    .fill("PHIL");
  await expect(
    page.getByRole("option", { name: "PHIL 210 · Ethics Course" }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/review/search.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: ".local/review/settings-dark.png" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: ".local/review/dashboard-dark.png" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: ".local/review/dashboard-laptop.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page
    .getByRole("button", { name: "Add semester", exact: true })
    .last()
    .click();
  await page
    .getByRole("textbox", { name: "Semester name", exact: true })
    .fill("Spring 2027");
  await page.getByLabel("Start date", { exact: true }).fill("2027-01-15");
  await page.getByLabel("End date", { exact: true }).fill("2027-05-20");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add semester", exact: true })
    .click();
  await expect(
    page
      .getByRole("combobox", { name: "Current semester" })
      .locator("option:checked"),
  ).toHaveText("Spring 2027");
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search UniDesk", exact: true })
    .fill("Midterm");
  await page
    .getByRole("option", { name: "Midterm Exam PHIL 210", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Midterm Exam", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("combobox", { name: "Current semester" })
      .locator("option:checked"),
  ).toHaveText("Fall 2026 · Archived");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Make active", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Exams", exact: true })
    .click();
  await page.getByRole("button", { name: "Add exam", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Notification verification");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await page.getByLabel("Date", { exact: true }).fill(tomorrowKey);
  await page.getByLabel("Start time", { exact: true }).fill("12:00");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add exam", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "CMPS 256 · Notification verification Due tomorrow",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "CMPS 256 · Notification verification Due tomorrow",
      exact: true,
    }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.locator(".quick-add summary").click();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Add course files" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Resources");
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles({
      name: "Quick add.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Quick Add native-compatible file flow"),
    });
  await expect(
    page.getByRole("button", { name: "Quick add.txt", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
