import { test, expect } from "@playwright/test";
import path from "node:path";
test("Course grade entry, projections, GPA scenarios and persistence", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const snap = async (name: string) =>
    page.screenshot({
      path: `.local/review/phase2-${name}.png`,
      fullPage: true,
    });
  const nav = (name: string) =>
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name, exact: true });
  const dialog = () => page.getByRole("dialog");
  const save = async () => {
    await dialog().getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog()).not.toBeVisible();
  };
  await page.goto("/");
  await page
    .getByLabel("University folder", { exact: true })
    .fill(path.resolve(".local/phase2-e2e-files", String(Date.now())));
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await page.getByRole('button',{name:'PHIL 210',exact:true}).first().click();
  await page.getByRole('button',{name:'Assessments',exact:true}).click();
  await page.getByRole('button',{name:'Grades',exact:true}).last().click();
  for (const [name, weight] of [
    ["Midterm", "40"],
    ["Final", "60"],
  ]) {
    await page
      .getByRole("button", { name: "Add component", exact: true })
      .click();
    await dialog().getByLabel("Component name").fill(name);
    await dialog().getByLabel("Course weight (%)").fill(weight);
    await save();
  }
  for (const [title, category, score] of [
    ["Midterm score", "Midterm", "80"],
    ["Final score", "Final", ""],
  ]) {
    await page.getByRole("button", { name: "Add grade", exact: true }).click();
    await dialog().getByLabel("Title", { exact: true }).fill(title);
    await dialog()
      .getByLabel("Component", { exact: true })
      .selectOption({ label: category });
    await dialog().getByLabel("Points earned (blank = ungraded)").fill(score);
    await save();
  }
  await expect(
    page.getByText("Current grade 80.0%", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Final score", { exact: true }).fill("90");
  await expect(
    page.getByText("Projected final grade 86.0%", { exact: true }),
  ).toBeVisible();
  await snap("course-grades");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(page.getByLabel("Final score", { exact: true })).toHaveValue("");
  await nav("Grades").click();
  await page.getByLabel("PHIL 210 scenario").selectOption("A");
  await snap("semester-grades");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await page.reload();
  await page.getByRole('button',{name:'PHIL 210',exact:true}).first().click();
  await page.getByRole('button',{name:'Assessments',exact:true}).click();
  await page.getByRole('button',{name:'Grades',exact:true}).last().click();
  await expect(page.getByText('Current grade 80.0%',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Dark',exact:true}).click();
  await nav('Grades').click(); await snap('grades-dark');
  expect(errors).toEqual([]);
});
