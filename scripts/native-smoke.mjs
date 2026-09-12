import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {pdfFixture,docxFixture,pptxFixture} from '../tests/document-fixtures.ts';
const root = process.cwd(),
  run = path.join(root, ".local/native-smoke", String(Date.now()));
fs.mkdirSync(run, { recursive: true });
const env = {
  ...process.env,
  UNIDESK_DATA_DIR: run,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    "--remote-debugging-port=9231 --remote-allow-origins=http://localhost:9231",
  WEBVIEW2_USER_DATA_FOLDER: path.join(run, "webview"),
};
let processHandle;
async function openApp() {
  processHandle = spawn(
    path.join(root, "src-tauri/target/release/unidesk.exe"),
    [],
    { env, windowsHide: true, stdio: "ignore" },
  );
  let browser;
  for (let i = 0; i < 40; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9231");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!browser) throw Error("Native WebView did not become available.");
  const context = browser.contexts()[0];
  let page = context.pages()[0];
  if (!page) page = await context.waitForEvent("page");
  return { browser, page };
}
async function closeApp(browser) {
  await browser.close();
  if (processHandle && !processHandle.killed) {
    processHandle.kill();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
async function navigation(page,name) {
  const trigger=page.getByRole('button',{name:'Open navigation'});
  if(await trigger.isVisible())await trigger.click();
  await page.getByRole('button',{name,exact:true}).first().click();
}
let connected;
try {
  connected = await openApp();
  const { page } = connected;
  await expect(
    page.getByRole("heading", { name: "Welcome to UniDesk" }),
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("textbox", { name: "University folder", exact: true })
    .fill(path.join(run, "University"));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Create semester", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Good", exact: false }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Add course", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Course code", exact: true })
    .fill("NAT 101");
  await page
    .getByRole("textbox", { name: "Course name", exact: true })
    .fill("Native Verification");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add course", exact: true })
    .click();
  await navigation(page,"NAT 101");
  await page.getByRole('navigation', { name: 'Course sections' }).getByRole('button', { name: 'Materials', exact: true }).click();
  await page.getByRole("button", { name: "Lectures", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Imported through native.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Native import contents"),
  });
  await expect(
    page.getByRole("button", {
      name: "Imported through native.txt",
      exact: true,
    }),
  ).toBeVisible();
  const original = path.join(
    run,
    "University/Fall 2026/NAT101/Lectures/Native file.txt",
  );
  fs.writeFileSync(original, "A normal academic document.");
  await page
    .getByRole("button", { name: "Refresh files", exact: true })
    .click();
  await page.getByRole("button", { name: "Readings", exact: true }).click();
  await page.getByRole("button", { name: "Lectures", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search files", exact: true })
    .fill("Native");
  await expect(
    page.getByRole("button", { name: "Native file.txt", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Actions for Native file.txt", { exact: true }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "File name", exact: true })
    .fill("Native renamed.txt");
  await page.getByRole("button", { name: "Rename file", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Native renamed.txt", exact: true }),
  ).toBeVisible();
  if (!fs.existsSync(path.join(path.dirname(original), "Native renamed.txt")))
    throw Error("Native rename failed.");
  const nativeCommand=(name,args)=>page.evaluate(({name,args})=>window.__TAURI_INTERNALS__.invoke(name,args),{name,args});
  const [nativeCourse]=await nativeCommand('query',{sql:"SELECT id FROM courses WHERE code='NAT 101'",params:[]});
  const safetyFile=await nativeCommand('import_file',{courseId:nativeCourse.id,category:'Resources',filename:'Recycle verification.txt',bytes:[84,101,115,116]});
  await nativeCommand('file_action',{id:safetyFile.id,action:'move',category:'Readings'});
  const [movedFile]=await nativeCommand('query',{sql:'SELECT absolute_path FROM files WHERE id=?',params:[safetyFile.id]});
  if(!fs.existsSync(movedFile.absolute_path)||!movedFile.absolute_path.includes('Readings'))throw Error('Native move did not retain the file');
  await nativeCommand('file_action',{id:safetyFile.id,action:'reveal'});
  await nativeCommand('file_action',{id:safetyFile.id,action:'remove',disk:true});
  if(fs.existsSync(movedFile.absolute_path)||(await nativeCommand('query',{sql:'SELECT id FROM files WHERE id=?',params:[safetyFile.id]})).length)throw Error('Native Recycle Bin removal failed');
  await page.locator('input[type=file]').setInputFiles([
    {name:'Native reading.pdf',mimeType:'application/pdf',buffer:pdfFixture(['Introduction','Native consequentialism evidence'])},
    {name:'Native notes.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:docxFixture()},
    {name:'Native slides.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:pptxFixture()},
  ]);
  await page.getByRole('button',{name:'Materials',exact:true}).click();
  await page.getByLabel('Search course materials',{exact:true}).fill('consequentialism');
  await expect(page.locator('.material-result').filter({hasText:'Native consequentialism evidence'}).first()).toContainText('Native consequentialism evidence',{timeout:45000});
  await expect(page.locator('.material-result')).toContainText('Page 2');
  await page.getByLabel('Search course materials',{exact:true}).fill('disagreement');
  await expect(page.locator('.material-result')).toContainText('Section: Objections',{timeout:30000});
  await page.getByLabel('Search course materials',{exact:true}).fill('egoism');
  await expect(page.locator('.material-result')).toContainText('Slide 1',{timeout:30000});
  await page.getByLabel('Search course materials',{exact:true}).fill('normal academic document');
  await expect(page.locator('.material-result')).toContainText('Native renamed.txt',{timeout:30000});
  await page.screenshot({path:'.local/review/phase4-native-materials.png'});
  await navigation(page,"Settings");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const baselineDpr = await page.evaluate(() => window.devicePixelRatio);
  await page.getByLabel("Interface size", {exact:true}).selectOption("150");
  await expect.poll(()=>page.evaluate(()=>window.devicePixelRatio)).toBeGreaterThanOrEqual(baselineDpr);
  if (await page.evaluate(()=>document.documentElement.style.zoom !== ""))
    throw Error("Native interface zoom failed and used the browser fallback.");
  await page.screenshot({ path: ".local/review/native-interface-150.png" });
  await navigation(page,"Emails");
  await expect(page.getByRole("heading",{name:"Connect your university mailbox",exact:true})).toBeVisible();
  await navigation(page,"Settings");
  await expect(page.getByLabel("Interface size", {exact:true})).toHaveValue("150");
  await page.screenshot({ path: ".local/review/native-settings.png" });
  await closeApp(connected.browser);
  connected = await openApp();
  await expect(
    connected.page.getByRole("heading", { name: "Good", exact: false }),
  ).toBeVisible({ timeout: 20000 });
  await expect(connected.page.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await navigation(connected.page,"Settings");
  await expect(connected.page.getByLabel("Interface size",{exact:true})).toHaveValue("150");
  await connected.page.keyboard.press("Control+0");
  await expect(connected.page.getByLabel("Interface size",{exact:true})).toHaveValue("100");
  await navigation(connected.page,"NAT 101");
  await expect(connected.page.getByRole("heading",{name:"NAT 101",exact:true})).toBeVisible();
  await connected.page.screenshot({
    path: ".local/review/native-reopened.png",
  });
  await closeApp(connected.browser);
  connected = null;
  const db = new DatabaseSync(path.join(run, "unidesk.db"), { readOnly: true });
  if (db.prepare("SELECT count(*) AS count FROM courses").get().count !== 1)
    throw Error("Native course persistence failed.");
  if (
    !db
      .prepare("SELECT filename FROM files WHERE filename=?")
      .get("Native renamed.txt")
  )
    throw Error("Native metadata persistence failed.");
  if (db.prepare("PRAGMA user_version").get().user_version !== 21)
    throw Error("Platform sync migration was not applied.");
  if(db.prepare("SELECT count(*) n FROM documents WHERE status='Indexed'").get().n!==5)
    throw Error('Native extracted documents did not persist.');
  db.close();
  console.log(
    "PASS: native startup, SQLite migration, course directories, Explorer file discovery/reveal, rename/move, Recycle Bin removal, theme, native 150% interface scaling and keyboard reset, email setup screen, native PDF/DOCX/PPTX extraction and material search, full process restart persistence.",
  );
  console.log("Isolated native test data: " + run);
} catch(error) {
  if(connected) {console.error(await connected.page.locator("body").innerText());await connected.page.screenshot({path:path.join(run,"failure.png")}).catch(()=>{});}
  throw error;
} finally {
  if (connected) await closeApp(connected.browser);
  else processHandle?.kill();
}
