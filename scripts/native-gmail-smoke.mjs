// Packaged Gmail UI with mocked OAuth/Gmail responses; native database and files are real.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd(),
  run = path.join(root, ".local/native-gmail-smoke", String(Date.now()));
fs.mkdirSync(run, { recursive: true });
const child = spawn(
  path.join(root, "src-tauri/target/release/unidesk.exe"),
  [],
  {
    env: {
      ...process.env,
      UNIDESK_DATA_DIR: run,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=9233 --remote-allow-origins=http://localhost:9233",
      WEBVIEW2_USER_DATA_FOLDER: path.join(run, "webview"),
    },
    windowsHide: true,
    stdio: "ignore",
  },
);
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9233");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser) throw Error("Native Gmail test could not connect.");
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Welcome to UniDesk" }),
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByLabel("University folder", { exact: true })
    .fill(path.join(run, "University"));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create semester", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke.bind(
      window.__TAURI_INTERNALS__,
    );
    window.__gmailTest = {
      mode: "pending",
      begins: 0,
      pages: 0,
      history: 0,
      original,
    };
    const originalFetch = window.fetch.bind(window);
    const mock = async (command, args) => {
      const t = window.__gmailTest;
      if (command === "gmail_auth") {
        if (args.action === "cancel") return null;
        if (args.action === "begin") {
          t.begins++;
          if (t.mode === "network")
            throw {
              code: "network",
              message:
                "Gmail is unavailable. Check your connection; cached email is still available.",
            };
          return { sessionId: "fixture-session" };
        }
        if (args.action === "status") {
          if (t.mode === "expired")
            throw {
              code: "expired",
              message:
                "Google sign-in timed out. Retry to open a new sign-in window.",
            };
          if (t.mode !== "success") return { pending: true };
          await original("batch", {
            statements: [
              {
                sql: "INSERT INTO email_accounts(id,provider,mail_provider,email_address,client_id,connected) VALUES('gmail:test','microsoft','gmail','dedicated@gmail.com','123456789012-test.apps.googleusercontent.com',1) ON CONFLICT(id) DO UPDATE SET connected=1,sync_error='',retry_after=NULL",
              },
            ],
          });
          return {
            connected: true,
            accountId: "gmail:test",
            emailAddress: "dedicated@gmail.com",
          };
        }
      }
      if (command === "gmail_request") {
        if (args.operation === "disconnect") {
          await original("batch", {
            statements: [
              {
                sql: "UPDATE email_accounts SET connected=0 WHERE id='gmail:test'",
              },
            ],
          });
          return null;
        }
        if (t.mode === "revoked")
          throw {
            code: "invalid_grant",
            message:
              "Gmail connection needs attention. Reconnect to renew access.",
          };
        if (args.operation === "profile") return { historyId: "100" };
        if (args.operation === "list") {
          t.pages++;
          return { messages: [{ id: "message-1" }] };
        }
        if (args.operation === "history") {
          t.history++;
          return {
            historyId: "101",
            history: [{ messagesAdded: [{ message: { id: "message-1" } }] }],
          };
        }
        if (args.operation === "message")
          return {
            id: "message-1",
            threadId: "thread-1",
            internalDate: String(Date.parse("2026-09-10T08:00:00Z")),
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "From", value: "Student <student@aub.edu.lb>" },
                { name: "Subject", value: "Fwd: PHIL 210 deadline" },
              ],
              body: {
                data: btoa(
                  "---------- Forwarded message ---------\nFrom: Dr. Smith <smith@aub.edu.lb>\nDate: Mon, 7 Sep 2026 10:00:00 +0300\nSubject: PHIL 210 Assignment 2\nTo: student@aub.edu.lb\n\nAssignment 2 is now due September 14 instead of September 11.",
                )
                  .replace(/=/g, "")
                  .replace(/\+/g, "-")
                  .replace(/\//g, "_"),
              },
            },
          };
        if (args.operation === "open") {
          t.opened = true;
          return null;
        }
      }
      return original(command, args);
    };
    window.fetch = async (url, options) => {
      const command = new URL(String(url), location.href).pathname.slice(1);
      if (!["gmail_auth", "gmail_request"].includes(command))
        return originalFetch(url, options);
      try {
        return new Response(
          JSON.stringify(await mock(command, JSON.parse(options.body))),
          {
            headers: {
              "Content-Type": "application/json",
              "Tauri-Response": "ok",
            },
          },
        );
      } catch (error) {
        return new Response(JSON.stringify(error), {
          headers: {
            "Content-Type": "application/json",
            "Tauri-Response": "error",
          },
        });
      }
    };
  });
  const sql = (sql, params = []) =>
    page.evaluate(
      ({ sql, params }) =>
        window.__gmailTest.original("query", { sql, params }),
      { sql, params },
    );
  const write = (statements) =>
    page.evaluate(
      (statements) => window.__gmailTest.original("batch", { statements }),
      statements,
    );
  const semester = (await sql("SELECT id FROM semesters LIMIT 1"))[0].id;
  await write([
    {
      sql: "INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('gmail-course',?,'PHIL 210','Ethics',?)",
      params: [semester, path.join(run, "University", "PHIL210")],
    },
    {
      sql: "INSERT INTO assignments(id,course_id,title,due_date,due_time) VALUES('gmail-assignment','gmail-course','Assignment 2','2026-09-11','23:59')",
    },
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Email source")).toHaveValue("gmail");
  const input = page.getByLabel("Google OAuth Client ID", { exact: true });
  await input.fill("bad-id");
  await page
    .getByRole("button", { name: "Connect Gmail", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Desktop app client ID");
  expect(await page.evaluate(() => window.__gmailTest.begins)).toBe(0);
  await input.fill("123456789012-test.apps.googleusercontent.com");
  await page.getByText("Google Desktop app configuration").click();
  await page
    .getByLabel("Google Desktop app client secret")
    .fill("fixture-desktop-secret");
  await page
    .getByRole("button", { name: "Connect Gmail", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel Google sign-in" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel Google sign-in" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel Google sign-in" }),
  ).toHaveCount(0);
  await page.evaluate(() => (window.__gmailTest.mode = "expired"));
  await page
    .getByRole("button", { name: "Connect Gmail", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("timed out");
  await page.evaluate(() => (window.__gmailTest.mode = "success"));
  await page
    .getByRole("button", { name: "Retry Gmail connection", exact: true })
    .click();
  await expect(page.locator(".email-account")).toContainText(
    "dedicated@gmail.com",
  );
  await expect
    .poll(
      async () =>
        (await sql("SELECT count(*) n FROM email_detected_actions"))[0].n,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  expect((await sql("SELECT count(*) n FROM emails"))[0].n).toBe(1);
  expect(
    (await sql("SELECT count(*) n FROM notifications WHERE type='email'"))[0].n,
  ).toBe(1);
  expect(await page.evaluate(() => window.__gmailTest.history)).toBeGreaterThan(
    0,
  );
  await input.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".local/review/gmail-settings.png" });
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name, exact: true });
  await nav("Emails").click();
  await page.locator(".email-row").click();
  await expect(
    page.getByText("smith@aub.edu.lb", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Proposed date", { exact: true })).toHaveValue(
    "2026-09-14",
  );
  await expect(
    page.getByRole("button", { name: "Open in Gmail" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open in Gmail" }).click();
  expect(await page.evaluate(() => window.__gmailTest.opened)).toBe(true);
  await page.screenshot({ path: ".local/review/gmail-forward-review.png" });
  await page.getByRole("button", { name: "Apply reviewed change" }).click();
  expect(
    (
      await sql(
        "SELECT due_date,due_time FROM assignments WHERE id='gmail-assignment'",
      )
    )[0],
  ).toEqual({ due_date: "2026-09-14", due_time: "23:59" });
  await page.getByRole("button", { name: "Reanalyze", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply reviewed change" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.evaluate(() => (window.__gmailTest.mode = "revoked"));
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("needs attention");
  await page.evaluate(() => (window.__gmailTest.mode = "success"));
  await page
    .getByRole("button", { name: "Reconnect Gmail", exact: true })
    .click();
  await expect(page.locator(".email-account")).not.toContainText(
    "needs attention",
  );
  await page
    .getByRole("button", { name: "Disconnect Gmail", exact: true })
    .click();
  await expect(page.locator(".email-account")).toContainText("Disconnected");
  expect((await sql("SELECT count(*) n FROM emails"))[0].n).toBe(1);
  for (const name of [
    "Dashboard",
    "Courses",
    "Calendar",
    "Assignments",
    "Exams",
    "Tasks",
    "Study",
    "Grades",
    "Emails",
  ]) {
    await nav(name).click();
    await expect(page.locator("main")).toBeVisible();
  }
  await page.reload();
  await nav("Emails").click();
  await expect(page.locator(".email-row")).toHaveCount(1);
  expect(errors).toEqual([]);
  console.log(
    "PASS native Gmail: config, cancel/expiry, mocked OAuth, sync/history, original sender, dedup, review/apply, safe Gmail link, revoked/reconnect/disconnect, cached navigation and reload. Live Google login not tested.",
  );
  console.log(run);
} finally {
  if (browser) await browser.close();
  child.kill();
}
