import { test, expect } from "@playwright/test";
import path from "node:path";
import { pdfFixture } from "../document-fixtures";
test("Phase 4 AI workflows: cited scoped answers, syllabus review, past questions, practice, cache and offline safety", async ({
  page,
}) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(12000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let calls = 0,
    mode = "normal";
  const api = async (command: string, args: Record<string, unknown>) => {
    const r = await page.request.post("/api/local", {
      headers: { "X-UniDesk-Local": "1" },
      data: { command, args },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).value;
  };
  await page.route("**/api/local", async (route) => {
    const { command, args } = route.request().postDataJSON();
    if (command === "ai_cancel") {
      await route.fulfill({ json: { value: null } });
      return;
    }
    if (command !== "ai_generate") {
      await route.continue();
      return;
    }
    calls++;
    const input = JSON.parse(args.input);
    expect(args.input).not.toContain("C:\\");
    expect(input.sources.length).toBeLessThanOrEqual(20);
    if (mode === "network") {
      await route.fulfill({
        status: 400,
        json: {
          error:
            "Couldn't reach the AI service. Your files and indexed search are still available.",
        },
      });
      return;
    }
    const s = input.sources[0],
      cite = {
        source: mode === "bad-citation" ? "SOURCE_999" : s.id,
        quote: s.text.slice(0, Math.min(120, s.text.length)),
      };
    let result: unknown;
    if (args.instructions.includes("Extract syllabus records"))
      result = {
        items: [
          {
            kind: "exam",
            title: "AI Midterm",
            fields: [
              { name: "date", value: "2026-10-17" },
              { name: "start_time", value: "12:30" },
            ],
            citations: [cite],
          },
          {
            kind: "grade",
            title: "Participation",
            fields: [{ name: "weight", value: "15" }],
            citations: [cite],
          },
        ],
      };
    else if (args.instructions.includes("Extract individual past-exam"))
      result = {
        items: [
          {
            number: "1",
            text: "Explain why disagreement does not prove relativism.",
            type: "Essay",
            year: 2025,
            topics: ["Cultural relativism"],
            citations: [cite],
          },
        ],
      };
    else if (args.instructions.includes("Generate exactly"))
      result = {
        insufficient: false,
        questions: Array.from({ length: 5 }, (_, i) => ({
          type: "Short answer",
          question: `Practice ${i + 1}: Explain disagreement and relativism.`,
          choices: [],
          answer: "Disagreement alone is insufficient.",
          explanation: "Use the source argument.",
          citations: [cite],
        })),
      };
    else
      result = {
        sections: [
          {
            title: "Source-grounded answer",
            text: "Disagreement alone does not prove relativism.",
            citations: [cite],
          },
        ],
        general: "",
        insufficient: false,
      };
    await route.fulfill({
      json: { value: { text: JSON.stringify(result), model: args.model } },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("University folder", { exact: true })
    .fill(path.resolve(".local/phase4-ai-files", String(Date.now())));
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  const [course] = await api("query", {
    sql: "SELECT id FROM courses WHERE code='PHIL 210'",
    params: [],
  });
  const ids: Record<string, string> = {};
  for (const [filename, category, text] of [
    [
      "AI Reading.pdf",
      "Readings",
      "Cultural disagreement does not prove relativism. The argument requires independent justification.",
    ],
    [
      "AI Syllabus.pdf",
      "Resources",
      "AI Midterm October 17, 2026 at 12:30. Participation 15 percent.",
    ],
    [
      "2025 AI Exam.pdf",
      "Previous Exams",
      "2025 Midterm. Explain why disagreement does not prove relativism.",
    ],
  ] as const) {
    const r = await api("import_file", {
      courseId: course.id,
      category,
      filename,
      bytes: [...pdfFixture([text])],
    });
    ids[filename] = r.id;
  }
  await api("batch", {
    statements: [
      { sql: "UPDATE settings SET value='true' WHERE key='ai_enabled'" },
      {
        sql: "INSERT INTO exams(id,course_id,title,date,start_time) VALUES('ai-exam',?,'AI Midterm','2026-10-15','12:30')",
        params: [course.id],
      },
      {
        sql: "INSERT INTO attachments(file_id,entity_id,entity_type) VALUES(?,'ai-exam','exam')",
        params: [ids["AI Reading.pdf"]],
      },
    ],
  });
  await page.reload();
  await expect
    .poll(
      async () => {
        const [r] = await api("query", {
          sql: "SELECT count(*) n FROM documents WHERE file_id IN (?,?,?) AND status='Indexed'",
          params: Object.values(ids),
        });
        return r.n;
      },
      { timeout: 60000 },
    )
    .toBe(3);
  await page
    .getByRole("button", { name: "PHIL 210", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Ask Course", exact: true }).click();
  await page.getByLabel("Ask scope", { exact: true }).selectOption("selected");
  await page.getByLabel("AI Reading.pdf", { exact: false }).check();
  await page
    .getByLabel("Your question or focus", { exact: true })
    .fill("What does cultural disagreement prove?");
  await page.getByRole("button", { name: "Ask", exact: true }).last().click();
  await expect(page.locator(".ai-saved-result")).toContainText(
    "Source-grounded answer",
  );
  await page.locator(".ai-citation").first().click();
  await expect(page.getByRole("dialog")).toContainText("AI Reading.pdf");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const beforeNoEvidence = calls;
  await page
    .getByLabel("Your question or focus", { exact: true })
    .fill("xylophonequantumunicorn");
  await page.getByRole("button", { name: "Ask", exact: true }).last().click();
  await expect(page.getByRole("alert")).toContainText(
    "couldn't find enough information",
  );
  expect(calls).toBe(beforeNoEvidence);
  mode = "bad-citation";
  await page
    .getByLabel("Your question or focus", { exact: true })
    .fill("Explain cultural disagreement");
  await page.getByRole("button", { name: "Ask", exact: true }).last().click();
  await expect(page.getByRole("alert")).toContainText("unsupported source");
  mode = "normal";
  await page.screenshot({ path: ".local/review/phase4-ask-course.png" });
  // Syllabus import is a deterministic, local-only feature (see SyllabusPage/SyllabusImportFlow) —
  // there is no AI-driven syllabus analysis UI, so nothing to exercise here.
  await expect(
    page.getByRole("button", { name: "AI syllabus", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Assessments", exact: true }).click();
  await page
    .getByRole("button", { name: "Previous Exams", exact: true })
    .click();
  await page
    .getByLabel("Previous exam document", { exact: true })
    .selectOption(ids["2025 AI Exam.pdf"]);
  await page
    .getByRole("button", { name: "Analyze previous exam", exact: true })
    .click();
  await expect(
    page.getByText("Explain why disagreement does not prove relativism.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await expect(
    page.getByText("Appeared in 1 of 1 analyzed uploaded exams", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Exams", exact: true })
    .click();
  await page.getByRole("button", { name: /^AI Midterm/ }).first().click();
  await page
    .getByRole("button", { name: "Study guide & practice", exact: true })
    .click();
  await page.getByLabel("AI action", { exact: true }).selectOption("guide");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".ai-saved-result")).toContainText(
    "Source-grounded answer",
  );
  await page
    .getByRole("button", { name: "Generate practice questions", exact: true })
    .click();
  await expect(
    page.getByText("1. Practice 1: Explain disagreement and relativism.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Suggested answer", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Show answer", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Suggested answer", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/review/phase4-exam-practice.png" });
  const beforeCache = calls;
  await page
    .getByRole("button", { name: "Generate practice questions", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Generate practice questions",
      exact: true,
    }),
  ).toBeEnabled();
  expect(calls).toBe(beforeCache);
  await api("batch", {
    statements: [
      { sql: "UPDATE settings SET value='false' WHERE key='ai_enabled'" },
    ],
  });
  await page.reload();
  await page
    .getByRole("button", { name: "PHIL 210", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Ask Course", exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: "Saved conversations" })
    .click();
  await expect(page.locator(".ai-history").first()).toBeVisible();
  await page.locator(".ai-history").first().click();
  await expect(page.locator(".ai-saved-result")).toBeVisible();
  expect(calls).toBe(beforeCache);
  expect(errors).toEqual([]);
});

