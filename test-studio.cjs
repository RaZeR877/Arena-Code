'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const projectDir = path.join(__dirname, 'data', 'projects');
const smokeName = 'Arena UI Smoke Test';
function cleanSmokeProjects() {
  if (!fs.existsSync(projectDir)) return;
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(projectDir, entry.name);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, '.arena-project.json'), 'utf8'));
      if (meta.name === smokeName) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

(async () => {
  cleanSmokeProjects();
  const launch = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(process.env.ARENA_URL || 'http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.click('#templatesBtn'); await page.click('[data-template="0"]');
    let frame = page.frameLocator('#studioFrame');
    await frame.locator('#title').fill('Ship the studio'); await frame.locator('#add button').click();
    console.log('Task board:', await frame.locator('#tasks .card').count());
    await page.click('#saveCanvas'); await page.click('#checkCanvas');
    console.log('Inspector:', (await page.locator('#consoleLines').innerText()).slice(0, 180));
    await page.click('[data-device="mobile"]'); await page.click('#closeModal');
    await page.click('#templatesBtn'); await page.click('[data-template="1"]');
    await page.frameLocator('#studioFrame').locator('#board button').first().waitFor();
    console.log('Memory cards:', await page.frameLocator('#studioFrame').locator('#board button').count());
    await page.click('#closeModal'); await page.click('#templatesBtn'); await page.click('[data-template="2"]');
    frame = page.frameLocator('#studioFrame'); await frame.locator('#products button').first().click();
    console.log('Cart:', await frame.locator('#cartCount').innerText());
    await page.click('#closeModal'); await page.click('#templatesBtn'); await page.click('[data-template="3"]');
    frame = page.frameLocator('#studioFrame'); await frame.locator('#range').selectOption('14');
    console.log('Chart bars:', await frame.locator('#chart button').count());
    await page.click('#closeModal'); await page.click('#aiBtn'); console.log('Free AI panel:', await page.locator('#loadLocal').count());
    await page.click('#demoTab'); await page.click('#modeBtn'); await page.click('[data-mode="Battle"]');
    await page.fill('#prompt', 'build a task list'); await page.click('#sendBtn'); await page.waitForSelector('[data-vote="A"]');
    await page.locator('[data-action="preview"]').first().click(); console.log('Editable canvas:', await page.locator('#codeEditor').count());
    await page.click('#closeModal'); await page.click('#newChat');
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log('Mobile overflow:', overflow);
    if (overflow) throw new Error('Main page overflows on mobile viewport.');

    await page.setViewportSize({ width: 1440, height: 1000 }); await page.click('#projectWorkspaceBtn');
    page.once('dialog', d => d.accept(smokeName)); await page.click('#projectCreate'); await page.waitForSelector('#projectCode');
    const explorerPosition = await page.locator('.project-files').evaluate(el => getComputedStyle(el).position);
    if (explorerPosition === 'fixed') throw new Error('Project explorer incorrectly inherits the fixed app-sidebar layout.');
    page.once('dialog', d => d.accept('src/index.js')); await page.click('#projectNewFile');
    await page.waitForFunction(() => document.querySelector('#projectFileName')?.textContent === 'src/index.js');
    await page.locator('#projectCode').fill('const answer = 42;\n'); await page.click('#projectSave');
    await page.click('#projectCheck'); await page.waitForFunction(() => document.querySelector('#projectOutput')?.innerText.includes('PASS'));
    console.log('Project workspace: created, edited, saved, and checked a JavaScript file.');
    await page.setViewportSize({ width: 390, height: 844 });
    const projectLayout = await page.evaluate(() => { const d = document.querySelector('.project-dialog'); const g = document.querySelector('.project-work-grid'); return { dialogWidth: d.clientWidth, dialogScrollWidth: d.scrollWidth, gridWidth: g.clientWidth, gridScrollWidth: g.scrollWidth }; });
    if (projectLayout.dialogScrollWidth > projectLayout.dialogWidth + 1 || projectLayout.gridScrollWidth > projectLayout.gridWidth + 1) throw new Error(`Project workspace overflows on mobile: ${JSON.stringify(projectLayout)}`);
    console.log('Mobile project layout:', projectLayout);
    console.log('Page errors:', errors);
    if (errors.length) throw new Error(`Uncaught browser errors: ${errors.join('; ')}`);
    const screenshotDir = path.join(__dirname, 'test-results'); fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, 'studio-preview.png'), fullPage: true });
  } finally {
    cleanSmokeProjects(); await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
