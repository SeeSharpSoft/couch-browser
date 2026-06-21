const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.join(__dirname, '..');

function postKey(page, key) {
  return page.evaluate((k) => window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_KEY', key: k }, '*'), key);
}

test('Real cursor is hidden on gamepad input and restored on real mouse move', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-hidecursor');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();
  await page.goto('file://' + path.join(__dirname, 'test.html'));
  await page.waitForTimeout(1500);

  // Any gamepad input should hide the real cursor.
  await postKey(page, 'ArrowDown');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.documentElement.classList.contains('couch-browser-gamepad-active'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe('none');

  // A genuine mouse move restores the real cursor.
  await page.mouse.move(200, 200);
  await page.mouse.move(220, 220);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.documentElement.classList.contains('couch-browser-gamepad-active'))).toBe(false);

  await context.close();
});

test('B / Escape closes an open popup instead of navigating browser history', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-cancel');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();
  await page.goto('file://' + path.join(__dirname, 'test.html'));
  await page.waitForTimeout(1500);

  const urlBefore = page.url();

  // Inject a popup with a recognizable close button (matches default selectors).
  await page.evaluate(() => {
    const dlg = document.createElement('div');
    dlg.id = 'my-popup';
    dlg.setAttribute('role', 'dialog');
    dlg.style.cssText = 'position:fixed;top:50px;left:50px;width:300px;height:200px;background:#fff;z-index:10000;';
    const close = document.createElement('button');
    close.className = 'close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = 'X';
    close.style.cssText = 'width:40px;height:40px;';
    close.addEventListener('click', () => { dlg.style.display = 'none'; });
    dlg.appendChild(close);
    document.body.appendChild(dlg);
  });
  await page.waitForTimeout(100);

  await expect(page.locator('#my-popup')).toBeVisible();

  // B (Escape) should close the popup, not change the page URL.
  await postKey(page, 'Escape');
  await page.waitForTimeout(150);

  await expect(page.locator('#my-popup')).toBeHidden();
  expect(page.url()).toBe(urlBefore);

  await context.close();
});
