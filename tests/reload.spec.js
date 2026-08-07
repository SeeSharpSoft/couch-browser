const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.join(__dirname, '..');

test('Y reloads the current tab only while RT is held', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-reload');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  // Provide a controllable gamepad before the extension injects gamepad.js.
  await context.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    window.__setGamepadButton = (index, pressed) => {
      buttons[index].pressed = pressed;
      buttons[index].value = pressed ? 1 : 0;
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ index: 0, id: 'test-gamepad', buttons, axes: [] }],
    });

    const reloads = Number(sessionStorage.getItem('reload-count') || 0) + 1;
    sessionStorage.setItem('reload-count', String(reloads));
  });

  const page = await context.newPage();
  await page.goto('file://' + path.join(__dirname, 'test.html'));
  await page.waitForTimeout(1000);

  // Y without RT is ignored.
  await page.evaluate(() => window.__setGamepadButton(3, true));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__setGamepadButton(3, false));
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => sessionStorage.getItem('reload-count'))).toBe('1');

  // Hold RT, then press Y; the background worker reloads this tab.
  await page.evaluate(() => window.__setGamepadButton(7, true));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__setGamepadButton(3, true));
  await page.waitForFunction(() => sessionStorage.getItem('reload-count') === '2');

  await context.close();
});
