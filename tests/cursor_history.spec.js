const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.join(__dirname, '..');

function postKey(page, key) {
  return page.evaluate((k) => window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_KEY', key: k }, '*'), key);
}

test('Right trigger cursor mode moves a virtual cursor and clicks under it', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-cursor');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Extensions only work in headful mode
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('file://' + path.join(__dirname, 'test.html'));
  await page.waitForTimeout(1500); // let the extension inject core.js + default config

  // Attach a click counter to the button.
  await page.evaluate(() => {
    window.__clicks = 0;
    document.getElementById('test-button').addEventListener('click', () => { window.__clicks++; });
  });

  // Enter cursor mode (right trigger held).
  await page.evaluate(() => {
    window.navigator.getGamepads = () => [];
    window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_CONNECTION', connected: false }, '*');
  });
  await postKey(page, 'CursorOn');
  await expect(page.locator('#couch-browser-cursor')).toBeHidden();

  await page.evaluate(() => {
    window.navigator.getGamepads = () => [{}];
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.postMessage({
    source: 'couch-browser-extension',
    type: 'COUCH_BROWSER_CONNECTION',
    connected: true
  }, '*'));
  await postKey(page, 'CursorOn');
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => window.CouchBrowserSiteLogic.cursorActive)).toBe(true);
  const cursor = page.locator('#couch-browser-cursor');
  await expect(cursor).toBeVisible();
  expect(await page.evaluate(() => {
    const position = window.CouchBrowserSiteLogic.cursorPosition;
    return position.x === window.innerWidth / 2 && position.y === window.innerHeight / 2;
  })).toBe(true);

  // Move the virtual cursor to the center of the button.
  await page.evaluate(() => {
    const r = document.getElementById('test-button').getBoundingClientRect();
    const pos = window.CouchBrowserSiteLogic.cursorPosition;
    const dx = (r.left + r.width / 2) - pos.x;
    const dy = (r.top + r.height / 2) - pos.y;
    window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_CURSOR', dx, dy }, '*');
  });
  await page.waitForTimeout(100);

  // A button in cursor mode dispatches a mouse click at the cursor position.
  await postKey(page, 'MouseClick');
  await page.waitForTimeout(100);

  expect(await page.evaluate(() => window.__clicks)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.CouchBrowserSiteLogic.current.id)).toBe('test-button');

  // Cursor clicks also move the navigation selection. Clicking a text input
  // follows the same activation path as A in navigation mode and opens the
  // virtual keyboard.
  await page.evaluate(() => {
    const input = document.getElementById('test-input');
    const r = input.getBoundingClientRect();
    const pos = window.CouchBrowserSiteLogic.cursorPosition;
    window.postMessage({
      source: 'couch-browser-extension', type: 'COUCH_BROWSER_CURSOR',
      dx: r.left + r.width / 2 - pos.x,
      dy: r.top + r.height / 2 - pos.y
    }, '*');
  });
  await postKey(page, 'MouseClick');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.CouchBrowserSiteLogic.current.id)).toBe('test-input');
  await expect(page.locator('#couch-browser-virtual-keyboard')).toBeVisible();

  // Leaving cursor mode hides the cursor.
  await postKey(page, 'CursorOff');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.CouchBrowserSiteLogic.cursorActive)).toBe(false);
  await expect(cursor).toBeHidden();

  await context.close();
});

test('Shoulder buttons trigger browser back/forward navigation', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-history');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();

  const pageA = 'file://' + path.join(__dirname, 'test.html');
  const pageB = 'file://' + path.join(__dirname, 'netflix-mock.html');

  await page.goto(pageA);
  await page.waitForTimeout(800);
  const urlA = page.url();
  await page.goto(pageB);
  await page.waitForTimeout(800);
  const urlB = page.url();

  // LB -> browser back.
  await postKey(page, 'NavBack');
  await page.waitForFunction((url) => window.location.href === url, urlA, { timeout: 5000 });
  expect(page.url()).toBe(urlA);

  // RB -> browser forward.
  await postKey(page, 'NavForward');
  await page.waitForFunction((url) => window.location.href === url, urlB, { timeout: 5000 });
  expect(page.url()).toBe(urlB);

  await context.close();
});
