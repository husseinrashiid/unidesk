import { test,expect } from '@playwright/test';
import path from 'node:path';
test('landscape productivity layout, portrait drawer and phone navigation retain local content',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1280,height:800});await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByLabel('University folder',{exact:true}).fill(path.resolve('.local/platform-ui-files',String(Date.now())));
  await page.getByRole('button',{name:'Explore with sample data'}).click();
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
  await page.getByRole('button',{name:'Courses',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Courses',exact:true})).toBeVisible();
  await page.screenshot({path:'.local/playwright-platform/landscape.png'});
  for(const viewport of [{width:1067,height:1707},{width:800,height:1280},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    const trigger=page.getByRole('button',{name:'Open navigation'});await expect(trigger).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Main navigation'})).not.toBeVisible();
    await trigger.click();await expect(page.getByRole('dialog',{name:'Navigation',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Dashboard',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Navigation',exact:true})).not.toBeVisible();
    await trigger.click();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);expect(overflow).toBe(false);
    await page.screenshot({path:`.local/playwright-platform/${viewport.width}.png`});
    await trigger.click();await page.getByRole('button',{name:/^Assignments/}).click();
    await page.getByRole('button',{name:'All',exact:true}).click();
    const cell=page.locator('.responsive-table tbody td').first();await expect(cell).toBeVisible();
    expect(await cell.getAttribute('data-label')).toBe('Assignment');
    expect(await cell.evaluate(e=>getComputedStyle(e).display)).toBe('block');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.getByRole('button',{name:'Add assignment',exact:true}).click();
    const form=page.getByRole('dialog');await expect(form).toBeVisible();
    const bounds=await form.boundingBox();expect(bounds!.height).toBeLessThanOrEqual(viewport.height);expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
    const submit=form.getByRole('button',{name:'Add assignment',exact:true});await submit.scrollIntoViewIfNeeded();await expect(submit).toBeInViewport();
    await page.screenshot({path:`.local/playwright-platform/modal-${viewport.width}.png`});
    await page.keyboard.press('Escape');await expect(form).not.toBeVisible();
  }
  await page.setViewportSize({width:1280,height:800});await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('local workspace queries start even when the device reports no network',async({context,page})=>{
 await context.addInitScript(()=>Object.defineProperty(Navigator.prototype,'onLine',{get:()=>false}));
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.startup-loading')).not.toBeVisible({timeout:30000});
 await expect(page.locator('.app-shell,.setup-panel').first()).toBeVisible();
});
