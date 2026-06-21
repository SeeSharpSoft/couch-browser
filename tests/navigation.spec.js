const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test('Netflix navigation moves selection between elements', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-nav');
  const extensionPath = path.join(__dirname, '..');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Extensions only work in headful mode
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('file://' + path.join(__dirname, 'netflix-mock.html'));

  // Hostname-based loading won't match a file:// URL, so inject the core engine
  // and the Netflix site config directly to exercise the navigation algorithm.
  const core = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
  await page.addScriptTag({ content: core });
  const logic = fs.readFileSync(path.join(__dirname, '..', 'sites', 'netflix.com.js'), 'utf8');
  await page.addScriptTag({ content: logic });
  await page.waitForTimeout(300);

  // Simulate gamepad input the same way gamepad.js forwards it to the site logic.
  const connect = async (connected) => {
    await page.evaluate((c) => {
        if (c) {
            window.navigator.getGamepads = () => [{}];
            if (!window.__couch_browser_mock_interval) {
                window.__couch_browser_mock_interval = setInterval(() => {
                    window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_CONNECTION', connected: true }, '*');
                }, 100);
            }
        } else {
            window.navigator.getGamepads = () => [];
            if (window.__couch_browser_mock_interval) {
                clearInterval(window.__couch_browser_mock_interval);
                window.__couch_browser_mock_interval = null;
            }
            window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_CONNECTION', connected: false }, '*');
        }
    }, connected);
    await page.waitForTimeout(150);
  };

  const send = async (key) => {
    await page.evaluate((k) => window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_KEY', key: k }, '*'), key);
    await page.waitForTimeout(150);
  };

  // Connect gamepad first, otherwise no selection will occur.
  await connect(true);
  // Send a dummy key to activate gamepad UI (show indicator)
  await send('ArrowRight');
  await send('ArrowLeft');

  const current = () => page.evaluate(() => {
    const el = window.CouchBrowserSiteLogic && window.CouchBrowserSiteLogic.current;
    return el ? el.id : null;
  });

  // Initial selection should be the first nav tab.
  expect(await current()).toBe('tab-home');

  // Right along the top navigation.
  await send('ArrowRight');
  expect(await current()).toBe('tab-tv');
  await send('ArrowRight');
  expect(await current()).toBe('tab-movies');

  // Down into the billboard CTAs.
  await send('ArrowDown');
  expect(['btn-play', 'btn-moreinfo']).toContain(await current());

  // Down into the first row of title cards.
  await send('ArrowDown');
  expect((await current()).startsWith('r1c')).toBeTruthy();

  // Right along the row.
  await send('ArrowRight');
  expect((await current()).startsWith('r1c')).toBeTruthy();

  // Down into the second row.
  await send('ArrowDown');
  expect((await current()).startsWith('r2c')).toBeTruthy();

  // The selection indicator should be visible and have a non-zero size.
  const indicator = page.locator('#couch-browser-selection-indicator');
  await expect(indicator).toBeVisible();
  const box = await indicator.boundingBox();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);

  // When an overlay/modal is shown, navigation must stay inside it.
  await page.evaluate(() => { document.getElementById('preview-modal').style.display = 'block'; });

  // First navigation after the modal opens should jump into the modal.
  await send('ArrowLeft');
  expect((await current()).startsWith('modal-')).toBeTruthy();

  // Exercising navigation in every direction must never escape the modal.
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowUp']) {
    await send(key);
    expect((await current()).startsWith('modal-')).toBeTruthy();
  }

  // We should be able to reach the modal's interactive elements.
  const reached = new Set();
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft']) {
    await send(key);
    reached.add(await current());
  }
  expect(reached.size).toBeGreaterThan(1);

  // Closing the overlay returns navigation to the page behind it.
  await page.evaluate(() => { document.getElementById('preview-modal').style.display = 'none'; });
  await send('ArrowUp');
  expect((await current()).startsWith('modal-')).toBeFalsy();

  await context.close();
});
