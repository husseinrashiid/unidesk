import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { pdfFixture, representativeSyllabus } from "../document-fixtures";
test("degree real PDF preview, table, planner, reimport and syllabus structured review persist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const api = async (command: string, args: Record<string, unknown>) => {
    const r = await page.request.post("/api/local", {
      headers: { "X-UniDesk-Local": "1" },
      data: { command, args },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).value;
  };
  await page.goto("/");
  await page
    .getByLabel("University folder", { exact: true })
    .fill(path.resolve(".local/rework-e2e-files", String(Date.now())));
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Degree Progress", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import degree evaluation", exact: true })
    .click();
  const actual = "C:/Users/user/Downloads/AUB/Degree evaluation record.pdf";
  const evaluation = fs.existsSync(actual)
    ? actual
    : {
        name: "Degree evaluation record.pdf",
        mimeType: "application/pdf",
        buffer: pdfFixture([
          fs.readFileSync(
            "tests/fixtures/degree-evaluation-pdf-raw.txt",
            "utf8",
          ),
        ]),
      };
  await page
    .getByLabel("Degree evaluation document", { exact: true })
    .setInputFiles(evaluation);
  await expect(
    page.getByRole("heading", { name: "Degree evaluation found", exact: true }),
  ).toBeVisible();
  expect(
    (await api("query", { sql: "SELECT count(*) n FROM degree_programs" }))[0]
      .n,
  ).toBe(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Import degree", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Degree sections" }),
  ).toBeVisible();
  await expect(
    page.getByText("85 earned + 17 in progress / 120 credits", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/review/degree-overview.png",
    fullPage: true,
  });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.screenshot({
    path: ".local/review/degree-overview-dark.png",
    fullPage: true,
  });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page
    .getByRole("navigation", { name: "Degree sections" })
    .getByRole("button", { name: "Requirements", exact: true })
    .click();
  const major = page
    .locator(".degree-group")
    .filter({
      has: page
        .locator("summary strong")
        .filter({ hasText: "Major requirements" }),
    });
  await expect(major.getByRole("row")).toHaveCount(9);
  await expect(
    major
      .getByRole("row")
      .filter({ hasText: "CMPS 215" })
      .getByRole("cell", { name: "In progress", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".academic-table")
      .getByRole("cell", { name: "Not counted", exact: true }),
  ).toHaveCount(0);
  const elect = page
    .locator(".degree-group")
    .filter({
      has: page.locator("summary strong").filter({ hasText: "CMPS electives" }),
    });
  await expect(elect.getByRole("row")).toHaveCount(7);
  await expect(elect.getByText("EECE 433 · Database Systems")).toBeVisible();
  await page.screenshot({
    path: ".local/review/degree-requirements.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Degree sections" })
    .getByRole("button", { name: "History", exact: true })
    .click();
  await page.getByText("3 previous attempts", { exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Not counted", exact: true }),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Plan graduation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Suggest a plan", exact: true })
    .click();
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await api("query", { sql: "SELECT count(*) n FROM degree_plans" }))[0]
          .n,
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("button",{name:"Save plan",exact:true})).toBeEnabled();
  await page.getByLabel("First planned semester").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".local/review/degree-planner.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Degree Progress", exact: true })
    .click();
  await expect(
    page.getByText("85 earned + 17 in progress / 120 credits", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Degree actions").click();
  await page
    .getByRole("button", { name: "Re-import degree evaluation", exact: true })
    .click();
  await page
    .getByLabel("Degree evaluation document", { exact: true })
    .setInputFiles(evaluation);
  await expect(
    page.getByRole("heading", {
      name: "Degree evaluation update",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply update", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Degree sections" }),
  ).toBeVisible();
  expect(
    (
      await api("query", {
        sql: "SELECT count(*) n FROM degree_courses WHERE status='in_progress' AND excluded=0",
      })
    )[0].n,
  ).toBe(6);
  await page
    .getByRole("button", { name: "PHIL 210", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "AI syllabus", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Syllabus", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Syllabus", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import syllabus", exact: true }).click();
  const syllabus = {
    name: "PHIL210 (Section 3).docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: representativeSyllabus(),
  };
  await page
    .getByLabel("Syllabus document", { exact: true })
    .setInputFiles(syllabus);
  await expect(
    page.getByRole("heading", { name: "Syllabus review", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("100% total", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/rule confidence|explicit course code|parser rule/i),
  ).toHaveCount(0);
  await expect(page.locator("input[type=text]:visible")).toHaveCount(0);
  await page.screenshot({
    path: ".local/review/syllabus-review.png",
    fullPage: true,
  });
  // The room/section conflict with the pre-existing sample course (Nicely 212) must be
  // resolved explicitly — it is not silently overwritten.
  await page.getByLabel("Resolve PHIL 210", { exact: true }).selectOption("update");
  await page
    .getByRole("checkbox", {
      name: "Add office hours to calendar",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Import selected", exact: true })
    .click();
  await expect(
    page.getByText("Selected syllabus information imported.", { exact: true }),
  ).toBeVisible();
  const [course] = await api("query", {
    sql: "SELECT id FROM courses WHERE code='PHIL 210'",
  });
  expect(
    (
      await api("query", {
        sql: "SELECT count(*) n FROM grade_categories WHERE course_id=?",
        params: [course.id],
      })
    )[0].n,
  ).toBe(4);
  expect(
    (
      await api("query", {
        sql: "SELECT count(*) n FROM exams WHERE course_id=? AND title='Final exam'",
        params: [course.id],
      })
    )[0].n,
  ).toBe(1);
  const officeCount = (
    await api("query", {
      sql: "SELECT count(*) n FROM calendar_events WHERE course_id=? AND title='Office hours'",
      params: [course.id],
    })
  )[0].n;
  expect(officeCount).toBeGreaterThan(0);
  const [syllabusRow] = await api("query", {
    sql: "SELECT source_filename FROM course_syllabus WHERE course_id=?",
    params: [course.id],
  });
  expect(syllabusRow.source_filename).toBe(syllabus.name);
  // The persistent Syllabus page (not the review form) is now showing.
  await expect(
    page.getByRole("heading", { name: "Syllabus review", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Sam Example")).toBeVisible();
  await expect(page.getByText("sam@example.edu")).toBeVisible();
  await expect(page.getByText(/Post Hall 203/).first()).toBeVisible();
  await expect(page.getByText(/Monday.*2:00 PM.*3:00 PM/)).toBeVisible();
  await expect(page.getByText("Added to calendar")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Participation" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "15%" })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Final exam/ }),
  ).toBeVisible();
  await expect(page.getByText("Attendance", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Missing 20% of classes results in failure/),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/review/syllabus-page.png",
    fullPage: true,
  });
  await page
    .getByRole("row", { name: /Final exam/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Final exam", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Courses", exact: true })
    .click();
  await page
    .getByRole("button", { name: "PHIL 210", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Syllabus", exact: true }).click();
  await api("batch", {
    statements: [
      {
        sql: "UPDATE exams SET date='2026-10-21' WHERE course_id=? AND title='Midterm'",
        params: [course.id],
      },
    ],
  });
  await page
    .getByRole("button", { name: "Replace syllabus", exact: true })
    .click();
  await page
    .getByLabel("Syllabus document", { exact: true })
    .setInputFiles(syllabus);
  await page
    .getByLabel("Resolve Midterm", { exact: true })
    .selectOption("update");
  await page
    .getByRole("checkbox", {
      name: "Add office hours to calendar",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Import selected", exact: true })
    .click();
  await expect(
    page.getByText(/Selected syllabus information imported/),
  ).toBeVisible();
  expect(
    (
      await api("query", {
        sql: "SELECT count(*) n FROM grade_categories WHERE course_id=?",
        params: [course.id],
      })
    )[0].n,
  ).toBe(4);
  expect(
    (
      await api("query", {
        sql: "SELECT count(*) n FROM calendar_events WHERE course_id=? AND title='Office hours'",
        params: [course.id],
      })
    )[0].n,
  ).toBe(officeCount);
  expect(
    (
      await api("query", {
        sql: "SELECT date FROM exams WHERE course_id=? AND title='Midterm'",
        params: [course.id],
      })
    )[0].date,
  ).toBe("2026-10-20");
  await page
    .getByRole("button", { name: "Replace syllabus", exact: true })
    .click();
  await page
    .getByLabel("Syllabus document", { exact: true })
    .setInputFiles({
      name: "limited.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("PHIL 210 - Ethics"),
    });
  await expect(
    page.getByRole("heading", {
      name: "We found limited syllabus information",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review manually", exact: true }),
  ).toBeVisible();
  await expect(page.locator("input[type=text]:visible")).toHaveCount(0);
  await page.screenshot({
    path: ".local/review/syllabus-limited.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "We found limited syllabus information",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "PHIL 210", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Syllabus", exact: true }).click();
  await expect(page.getByText("Last updated from", { exact: false })).toBeVisible();
  await expect(page.getByText(syllabus.name).first()).toBeVisible();
  // Edit mode: add a policy, a material and appointment-only office hours, and edit the
  // description directly on the page (no reimport needed), then confirm it survives reload.
  await page.getByRole("button", { name: "Edit syllabus info", exact: true }).click();
  await page.getByRole("button", { name: "Add policy", exact: true }).click();
  await page.getByLabel("Category", { exact: true }).selectOption("Late work");
  await page
    .getByLabel("Policy text", { exact: true })
    .fill("Late submissions lose 10% per day.");
  await page.getByRole("button", { name: "Save policy", exact: true }).click();
  await expect(page.getByText("Late work", { exact: true })).toBeVisible();
  await page.getByText("Required materials", { exact: true }).click();
  await page.getByRole("button", { name: "Add material", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Course reader");
  await page
    .getByLabel("Details", { exact: true })
    .fill("Available on Moodle.");
  await page.getByRole("button", { name: "Save material", exact: true }).click();
  await expect(page.getByText("Course reader", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add office hours", exact: true }).click();
  await page.getByLabel("By appointment", { exact: false }).check();
  await page
    .getByLabel("Note", { exact: true })
    .fill("By appointment — email to schedule");
  await page
    .getByRole("button", { name: "Save office hours", exact: true })
    .click();
  await expect(
    page.getByText("By appointment — email to schedule"),
  ).toBeVisible();
  await page
    .getByText("Course description & objectives", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit description & objectives", exact: true })
    .click();
  await page
    .getByLabel("Course description", { exact: true })
    .fill("An introduction to normative ethical theory.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("An introduction to normative ethical theory."),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "PHIL 210", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Syllabus", exact: true }).click();
  await expect(page.getByText("Late work", { exact: true })).toBeVisible();
  await expect(page.getByText("Course reader", { exact: true })).toBeVisible();
  await expect(
    page.getByText("By appointment — email to schedule"),
  ).toBeVisible();
  await expect(
    page.getByText("An introduction to normative ethical theory."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
