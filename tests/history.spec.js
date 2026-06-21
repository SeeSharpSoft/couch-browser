const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.join(__dirname, '..');

function postKey(page, key) {
  return page.evaluate((k) => window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_KEY', key: k }, '*'), key);
}

test('Selection state is restored when an overlay is closed', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-history');
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

  // 1. Initial state: select an element on the main page.
  await postKey(page, 'ArrowDown'); // Move to the first link
  await page.waitForTimeout(100);
  const initialId = await page.evaluate(() => window.CouchBrowserSiteLogic.current ? window.CouchBrowserSiteLogic.current.id || window.CouchBrowserSiteLogic.current.innerText : null);
  console.log('Initial selection:', initialId);

  // 2. Open an overlay.
  await page.evaluate(() => {
    const dlg = document.createElement('div');
    dlg.id = 'my-popup';
    dlg.setAttribute('role', 'dialog');
    dlg.style.cssText = 'position:fixed;top:50px;left:50px;width:300px;height:200px;background:#fff;z-index:10000;';
    const close = document.createElement('button');
    close.id = 'popup-close';
    close.className = 'close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = 'X';
    close.addEventListener('click', () => { dlg.remove(); });
    dlg.appendChild(close);
    document.body.appendChild(dlg);
  });
  await page.waitForTimeout(200);

  // 3. Verify selection moved to the overlay.
  const overlaySelection = await page.evaluate(() => window.CouchBrowserSiteLogic.current ? window.CouchBrowserSiteLogic.current.id : null);
  console.log('Overlay selection:', overlaySelection);
  expect(overlaySelection).toBe('popup-close');

  // 4. Close the overlay.
  await postKey(page, 'Escape');
  await page.waitForTimeout(200);

  // 5. Verify the previous selection on the main page is restored.
  const restoredId = await page.evaluate(() => window.CouchBrowserSiteLogic.current ? window.CouchBrowserSiteLogic.current.id || window.CouchBrowserSiteLogic.current.innerText : null);
  console.log('Restored selection:', restoredId);
  expect(restoredId).toBe(initialId);

  await context.close();
});
