const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const extensionPath = path.join(__dirname, '..');

function setupGamepad(page) {
  return page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const axes = [0, 0, 0, 0];
    window.__setButton = (index, pressed) => {
      buttons[index].pressed = pressed;
      buttons[index].value = pressed ? 1 : 0;
    };
    window.__setAxis = (index, value) => { axes[index] = value; };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ index: 0, id: 'test-gamepad', buttons, axes }],
    });
  });
}

test('cursor is the default mode and RT temporarily inverts it', async () => {
  const context = await chromium.launchPersistentContext(path.join(__dirname, '..', 'user-data-gamepad-mode'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const page = await context.newPage();
  await setupGamepad(page);
  await page.goto('data:text/html,<html><body></body></html>');
  await page.evaluate(() => {
    window.__keys = [];
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'COUCH_BROWSER_KEY') window.__keys.push(event.data.key);
    });
  });
  await page.addScriptTag({ content: fs.readFileSync(path.join(extensionPath, 'gamepad.js'), 'utf8') });
  await page.waitForTimeout(150);

  expect(await page.evaluate(() => window.__keys.includes('CursorOn'))).toBe(true);

  await page.evaluate(() => window.__setButton(7, true));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__keys.at(-1))).toBe('CursorOff');

  await page.evaluate(() => window.__setButton(7, false));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__keys.at(-1))).toBe('CursorOn');

  // Left-stick cursor movement makes A target the virtual cursor. D-pad
  // navigation switches A back to the selected element.
  await page.evaluate(() => window.__setAxis(0, 1));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__setButton(0, true));
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.__keys.at(-1))).toBe('MouseClick');
  await page.evaluate(() => {
    window.__setButton(0, false);
    window.__setAxis(0, 0);
    window.__setButton(15, true);
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__setButton(15, false));
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__setButton(0, true));
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.__keys.at(-1))).toBe('Enter');
  await context.close();
});

test('RT + Y toggles the default and a held left stick repeats navigation', async () => {
  const context = await chromium.launchPersistentContext(path.join(__dirname, '..', 'user-data-gamepad-repeat'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const page = await context.newPage();
  await setupGamepad(page);
  await page.goto('data:text/html,<html><body></body></html>');
  await page.evaluate(() => {
    window.__keys = [];
    window.__modes = [];
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'COUCH_BROWSER_KEY') window.__keys.push(event.data.key);
      if (event.data && event.data.type === 'COUCH_BROWSER_DEFAULT_MODE_SET') window.__modes.push(event.data.mode);
    });
  });
  await page.addScriptTag({ content: fs.readFileSync(path.join(extensionPath, 'gamepad.js'), 'utf8') });
  await page.waitForTimeout(100);

  // RT + Y switches the default from cursor to navigation. Releasing RT
  // then leaves navigation mode active.
  await page.evaluate(() => window.__setButton(7, true));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__setButton(3, true));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__setButton(3, false));
  await page.evaluate(() => window.__setButton(7, false));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__keys.at(-1))).toBe('CursorOff');
  expect(await page.evaluate(() => window.__modes.at(-1))).toBe('navigation');

  await page.evaluate(() => window.__setAxis(0, 1));
  await page.waitForTimeout(700);
  const repeated = await page.evaluate(() => window.__keys.filter((key) => key === 'ArrowRight').length);
  expect(repeated).toBeGreaterThanOrEqual(3);

  await page.evaluate(() => window.__setAxis(0, 0));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__keys.filter((key) => key === 'ArrowRight').length)).toBe(repeated);

  // D-pad presses remain edge-triggered even when held.
  await page.evaluate(() => window.__setButton(15, true));
  await page.waitForTimeout(300);
  const dpadPresses = await page.evaluate(() => window.__keys.filter((key) => key === 'ArrowRight').length);
  expect(dpadPresses).toBe(repeated + 1);
  await page.evaluate(() => window.__setButton(15, false));

  await context.close();
});

test('cursor and scroll speed settings affect emitted movement', async () => {
  const context = await chromium.launchPersistentContext(path.join(__dirname, '..', 'user-data-gamepad-speeds'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const page = await context.newPage();
  await setupGamepad(page);
  await page.goto('data:text/html,<html><body></body></html>');
  await page.evaluate(() => {
    window.__cursor = [];
    window.__scroll = [];
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'COUCH_BROWSER_CURSOR') window.__cursor.push(event.data);
      if (event.data && event.data.type === 'COUCH_BROWSER_SCROLL') window.__scroll.push(event.data);
    });
  });
  await page.addScriptTag({ content: fs.readFileSync(path.join(extensionPath, 'gamepad.js'), 'utf8') });
  await page.waitForTimeout(100);

  await page.evaluate(() => {
    window.postMessage({
      source: 'couch-browser-extension', type: 'COUCH_BROWSER_SETTINGS',
      cursorSpeed: 25, scrollSpeed: 2000
    }, '*');
    window.__setAxis(0, 1);
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__cursor.some((move) => move.dx === 25))).toBe(true);

  await page.evaluate(() => {
    window.__setAxis(0, 0);
    window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_DEFAULT_MODE', mode: 'navigation' }, '*');
    window.__setAxis(2, 1);
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__scroll.reduce((total, move) => total + move.dx, 0))).toBeGreaterThan(140);

  await context.close();
});
