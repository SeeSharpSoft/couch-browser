const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test('Virtual keyboard supports gamepad typing, caret movement and controller actions', async () => {
  const userDataDir = path.join(__dirname, '..', 'user-data-keyboard');
  const extensionPath = path.join(__dirname, '..');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const page = await context.newPage();
  await page.goto('file://' + path.join(__dirname, 'test.html'));

  // The extension normally injects these. Adding them explicitly also makes
  // this test independent of hostname-based site loading and injection timing.
  await page.addScriptTag({
    content: fs.readFileSync(path.join(__dirname, '..', 'virtual-keyboard.js'), 'utf8')
  });
  await page.addScriptTag({
    content: fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8')
  });
  await page.waitForTimeout(250);

  const send = async (key) => {
    await page.evaluate((value) => {
      window.postMessage({ source: 'couch-browser-extension', type: 'COUCH_BROWSER_KEY', key: value }, '*');
    }, key);
    await page.waitForTimeout(30);
  };

  await page.evaluate(() => {
    window.postMessage({
      source: 'couch-browser-extension',
      type: 'COUCH_BROWSER_CONNECTION',
      connected: true
    }, '*');
    document.getElementById('test-input').focus();
  });

  // A on the focused text input opens the keyboard.
  await send('Enter');
  const keyboard = page.locator('#couch-browser-virtual-keyboard');
  await expect(keyboard).toBeVisible();

  // Controller badges are present on their corresponding keys.
  await expect(keyboard.locator('.cbvk-badge-x')).toHaveText('X');
  await expect(keyboard.locator('.cbvk-badge-y')).toHaveText('Y');
  await expect(keyboard.locator('.cbvk-badge-lt')).toHaveText('LT');
  expect(await keyboard.locator('.cbvk-badge-x').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(35, 118, 216)');

  // Activate 1, then use LT/Shift to activate !.
  await send('KeyboardActivate');
  expect(await page.locator('#test-input').inputValue()).toBe('1');
  await send('ShiftOn');
  await send('KeyboardActivate');
  expect(await page.locator('#test-input').inputValue()).toBe('1!');
  await send('ShiftOff');

  // Y's keyboard action removes the previous character.
  await send('KeyboardBackspace');
  expect(await page.locator('#test-input').inputValue()).toBe('1');

  // D-pad/left-stick navigation selects the next virtual key; activate 2.
  await send('ArrowRight');
  await send('KeyboardActivate');
  expect(await page.locator('#test-input').inputValue()).toBe('12');

  // Right-stick arrow intent moves the input caret, then Backspace removes 1.
  await send('InputArrowLeft');
  await send('KeyboardBackspace');
  expect(await page.locator('#test-input').inputValue()).toBe('2');

  // X/Enter closes the keyboard, and B/Escape closes it after reopening.
  await send('Enter');
  await expect(keyboard).toBeHidden();
  await send('Enter');
  await expect(keyboard).toBeVisible();
  await send('Escape');
  await expect(keyboard).toBeHidden();

  await context.close();
});
