const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.join(__dirname, '..');

test('Tab switch intents activate the previous and next browser tabs', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-tabs');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  // Tab 0 and Tab 1 in the same window.
  const page0 = await context.newPage();
  await page0.goto('file://' + path.join(__dirname, 'test.html'));
  const page1 = await context.newPage();
  await page1.goto('file://' + path.join(__dirname, 'netflix-mock.html'));
  await page1.waitForTimeout(1500); // let content scripts + background load

  // page1 is the active/foreground tab now.
  await page1.bringToFront();
  await page1.waitForTimeout(200);

  // The gamepad input test verifies LT + LB/RB produce these intents.
  await page1.evaluate(() => window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_TAB', dir: 'prev' }, '*'));

  // Tab 0 should become active (visible) and tab 1 hidden.
  await page0.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 5000 });
  expect(await page0.evaluate(() => document.visibilityState)).toBe('visible');

  // Wait out the background switch cooldown before the next switch.
  await page0.waitForTimeout(500);

  // Now switch forward (next) back to tab 1.
  await page0.evaluate(() => window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_TAB', dir: 'next' }, '*'));
  await page1.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 5000 });
  expect(await page1.evaluate(() => document.visibilityState)).toBe('visible');

  await context.close();
});

test('Rapid shoulder presses advance only one tab (debounced)', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-tabs-debounce');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  // Three tabs: indices 0, 1, 2.
  const p0 = await context.newPage();
  await p0.goto('file://' + path.join(__dirname, 'test.html'));
  const p1 = await context.newPage();
  await p1.goto('file://' + path.join(__dirname, 'test.html'));
  const p2 = await context.newPage();
  await p2.goto('file://' + path.join(__dirname, 'netflix-mock.html'));
  await p2.waitForTimeout(1500);

  await p2.bringToFront();
  await p2.waitForTimeout(200);

  // Fire several "prev" intents in quick succession (as button bounce / multiple
  // relays would). The cooldown must collapse them into a single tab move.
  await p2.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_TAB', dir: 'prev' }, '*');
    }
  });
  await p2.waitForTimeout(600);

  // From index 2, a single step lands on the immediate neighbor (p1). If the
  // presses were NOT debounced, it would have advanced past p1 to p0 and this
  // waitForFunction would time out (p1 would never become the visible tab).
  await p1.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 5000 });
  expect(await p1.evaluate(() => document.visibilityState)).toBe('visible');

  await context.close();
});
