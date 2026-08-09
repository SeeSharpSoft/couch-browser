# Couch Browser Repurpose — Outstanding Implementation Plan

> Goal: turn the Netflix-only gamepad navigation into **universal gamepad navigation
> for every webpage**, driven by a central handler, with site-specific files only
> providing selectors/adjustments.

## The initial prompt was:
> the goal is to have gamepad support on each webpage. the gamepad support should similar to what is currently implemented for netflix.com only, namely highlight of selectable UI elements, navigating through these elements with left joystick, A button is enter or click, B button is escape or back. The right stick controls scrolling up and down and left and right. focusable elements should be identified by being links or reacting to clicks or enter button or other kinds of interaction elements. Overlayed elements should not be focusable, e.g. when an overlay or popup is over them. if there are nested interaction elements, then the X button should switch the focus to the inner elements, e.g. there is a clickable image and there are element placed within the image like links to the source or the painter. The support for all this should be implemented in a central handler, but site specific differences or adjustments should be considered from the sites directory. e.g. generally the users navigates between buttons and links etc, but in netflix there are elements that can only be identified via certain selectors. These selectors should be provided by the site specific implementation.

## Target behavior (central handler)
- Highlight the currently selectable UI element.
- **Left stick / D-pad**: spatial navigation between focusable elements.
- **A (button 0)**: Enter / click the selected element.
- **B (button 1)**: Escape / back — close overlay, exit drill-in, else dispatch Escape.
- **X (button 2)**: drill into nested interactive elements (e.g. links inside a
  clickable image — links to the source / the painter).
- **Right stick**: scroll up/down and left/right (continuous).
- Focusable detection: links, buttons, inputs, role/aria-interactive, `tabindex`,
  `onclick`, `contenteditable`, plus a `cursor:pointer` heuristic.
- Overlay scoping: elements behind a visible overlay/popup are NOT focusable.
- Nested grouping: by default select the **outermost** interactive element; X drills in.
- Site config (from `sites/`) supplies extra/exclude selectors, overlay selectors,
  close-button selectors, container mapping, indicator color, first-element hints,
  nesting mode, keyboard capture.

## Architecture overview
- `content.js` (isolated world): inject `gamepad.js`, `core.js`, then
  `sites/<domain>.js` (fallback `sites/default.js`). Preserve order via
  `script.async = false`.
- `gamepad.js` (main world): pure input. Posts `COUCH_BROWSER_KEY` (`ArrowUp/Down/Left/Right`,
  `Enter`, `Escape`, `PadX`) and `COUCH_BROWSER_SCROLL` (`{dx, dy}`). Keeps the connection
  indicator.
- `core.js` (main world): central navigation engine. Reads
  `window.CouchBrowser.registerSite(config)`; exposes `window.CouchBrowserSiteLogic`.
- `sites/default.js`: registers empty/base config (pure generic behavior).
- `sites/netflix.com.js`: registers Netflix config.

---

## DONE
- [x] **`gamepad.js`** rewritten as pure input.
  - Edge-triggered A→`Enter`, B→`Escape`, X(2)→`PadX`, D-pad→`Arrow*`.
  - Left stick (axes 0/1) → edge-triggered `Arrow*`.
  - Right stick (axes 2/3) → continuous `COUCH_BROWSER_SCROLL {dx,dy}` (deadzone 0.15,
    speed 18 px/frame).
  - No synthetic DOM key dispatch anymore (avoids double-activation; core owns it).
  - Connection indicator removed.

---

## TODO  *(all items below implemented — see DEVELOPMENT.md for the resulting architecture)*

### 1. `core.js` — central navigation engine  *(DONE)*
Create `d:\git\SeeSharpSoft\couch-browser\core.js` (Main World). Generalize the existing
`sites/netflix.com.js` algorithm. Key pieces:

**Config registration**
- `window.CouchBrowser = window.CouchBrowser || {}`.
- `window.CouchBrowser.registerSite(cfg)` stores `cfg` and re-initializes (config may
  arrive after core loads; support late registration).
- Merge over `DEFAULT_CONFIG`:
  ```js
  const DEFAULT_CONFIG = {
    name: 'default',
    indicatorColor: '#4CAF50',
    extraSelectors: [],
    excludeSelectors: [],
    overlaySelectors: [
      '[role="dialog"]', '[aria-modal="true"]', 'dialog[open]',
      '.modal.show', '.modal[open]', '.popup', '.overlay'
    ],
    closeSelectors: [
      'button[aria-label*="close" i]', '[data-uia*="close" i]',
      '[aria-label*="Close" i]', '.close'
    ],
    getContainer: null,            // (el) => Element|null, for indicator placement
    firstElementSelectors: [],     // preferred initial selection
    nesting: 'outermost',          // 'outermost' | 'innermost'
    useCursorPointer: true,        // cursor:pointer heuristic on/off
    captureKeyboard: false,        // intercept real arrow keys for navigation
    autoSelect: true               // auto-select first element on load
  };
  ```

**Generic focusable base selectors** (union with `config.extraSelectors`, minus
`config.excludeSelectors`):
```
a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),
select:not([disabled]), textarea:not([disabled]), summary, label[for],
[role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"],
[role="menuitemradio"], [role="tab"], [role="checkbox"], [role="radio"],
[role="switch"], [role="option"], [contenteditable="true"],
[onclick], [tabindex]:not([tabindex="-1"])
```

**`isVisible(el)`** — reuse Netflix version: rect > 1px, not `display:none`/
`visibility:hidden`/`pointer-events:none`, opacity > 0.

**`getActiveOverlay()`** — port from `netflix.com.js`: query `config.overlaySelectors`,
keep visible, keep outermost (not contained by another), pick highest `z-index`.

**`getNavigableElements(scope)`**
- `scope` = overlay || drillScope || document.
- Query base+extra selectors within scope; filter excludes; filter `isVisible`.
- Exclude the scope root element itself (important for drill-in).
- `cursor:pointer` heuristic (when `useCursorPointer`): also include elements whose
  computed `cursor === 'pointer'`; let nesting filter prune them.
- **Nesting filter:**
  - `outermost`: keep `el` only if no other candidate **contains** `el`
    (→ clickable image kept, inner links dropped until drilled).
  - `innermost`: keep `el` only if `el` does not **contain** another candidate
    (→ leaf anchors; preserves current Netflix behavior).

**Drill-in (X / `PadX`)**
- Maintain `drillScope` (Element | null).
- On `PadX`: compute inner navigables = navigables strictly inside `currentElement`
  (query within `currentElement`, exclude itself, visible). If > 0, set
  `drillScope = currentElement` and select first inner element.
- Scope resolution priority: active overlay > valid `drillScope` > document.
  (If an overlay opens above the drill scope, the overlay wins.)
- Invalidate `drillScope` if it's removed/hidden.

**`navigate(direction)`** — port the spatial algorithm verbatim from
`netflix.com.js` (strict cone score `primary + cross*3` with `cross <= primary*1.5`,
relaxed fallback `primary + cross*2`). Use `getScope()` for the root and validity
check (current must be in scope, visible, in document).

**`getFirstNavigableElement(root)`**
- If `root === document` and `config.firstElementSelectors` set, return first visible
  match in order; else fall back to `getNavigableElements(root)[0]`.

**`setCurrent(el)`** — set `currentElement`, `suppressFocusSync` guard around
`el.focus({preventScroll:true})`, `scrollIntoView({block:'nearest',inline:'nearest'})`,
update indicator.

**Selection indicator** — port `ensureIndicator()`/`updateSelectionIndicator()` from
Netflix. Border color = `config.indicatorColor`. Use `config.getContainer(el)` (if
provided) to choose the highlighted container; else highlight `el` directly.

**Activation (A / `Enter`)** — `activateCurrent()`: `currentElement.click()`
(guard against body/html). Single source of activation.

**Back (B / `Escape`)**:
1. If `drillScope` active (and no overlay) → clear it, reselect the former container.
2. Else if overlay active → click `config.closeSelectors` inside it.
3. Else → dispatch a real `Escape` `keydown`/`keyup` to `currentElement`/document
   (for site compatibility), since gamepad.js no longer dispatches keys.

**Scrolling (`COUCH_BROWSER_SCROLL`)** — handler:
- Find nearest scrollable ancestor of `currentElement` (computed
  `overflow-y/x` auto|scroll AND `scrollHeight>clientHeight` / `scrollWidth>clientWidth`);
  else `window`. Call `.scrollBy(dx, dy)` (or `window.scrollBy`). After scrolling,
  refresh the indicator position.

**Message listener** (`window.addEventListener('message', ...)`)
- Guard `event.data.source === 'couch-browser-extension'`.
- `COUCH_BROWSER_KEY`: `Arrow*`→`navigate`, `Enter`→`activateCurrent`, `Escape`→back logic,
  `PadX`→drill.
- `COUCH_BROWSER_SCROLL`: scroll handler.

**Keyboard sync**
- `focusin` listener (skip when `suppressFocusSync`): adopt focus as `currentElement`
  unless it's behind an active overlay; update indicator. (Keeps highlight in sync
  with mouse/Tab.)
- Trusted `keydown` arrow handler ONLY when `config.captureKeyboard` is true; skip when
  focus is in input/textarea/contenteditable.
- `scroll`/`resize` listeners → `updateSelectionIndicator(currentElement)`.

**Init**
- On `DOMContentLoaded` (or immediately if ready): if `config.autoSelect`,
  `setCurrent(getFirstNavigableElement())`.
- Re-run init logic on `registerSite` (config may load after DOM ready).

**Public API** (for tests):
```js
window.CouchBrowserSiteLogic = {
  update: () => updateSelectionIndicator(currentElement),
  navigate,
  get current() { return currentElement; }
};
```

### 2. `sites/netflix.com.js` — convert to config registration  *(DONE)*
Replace the whole file with a single `window.CouchBrowser.registerSite({...})` call:
- `indicatorColor: '#E50914'`
- `nesting: 'innermost'`  (preserves passing navigation test)
- `useCursorPointer: false`
- `captureKeyboard: true`
- `extraSelectors`: the current `NAV_SELECTORS` array.
- `overlaySelectors`: the current `OVERLAY_SELECTORS` array.
- `closeSelectors`: `['[data-uia*="close" i]', '.previewModal-close', 'button[aria-label*="close" i]', '[aria-label*="Close" i]']`
- `firstElementSelectors`: `['.navigation-tab a', '[data-uia="play-button"]', '.title-card a, .slider-refocus']`
- `getContainer`: port `getTargetElement()` (title-card-container, billboard-links,
  navigation-tab, nav-element, navigation-menu → else el).

### 3. `sites/default.js` — convert to config registration  *(DONE)*
Replace with `window.CouchBrowser.registerSite({})` (empty → all generic defaults).
Optional: keep a console log line for parity.

### 4. `content.js` — loader updates  *(DONE)*
- In `injectScript`, set `script.async = false` so injected scripts execute in
  insertion order (dynamically-created scripts default to `async`).
- Inject order: `gamepad.js`, then `core.js`, then the site config
  (`sites/<domain>.js` or `sites/default.js`). Keep existing `checkFileExists`
  HEAD-request domain detection.

### 5. `manifest.json`  *(DONE)*
- Add `"core.js"` to `web_accessible_resources[0].resources`
  (currently `["gamepad.js", "sites/*.js"]`).

### 6. Tests  *(DONE — both specs pass via `npm test`)*
- `tests/navigation.spec.js`: it injects `sites/netflix.com.js` directly. Now it must
  inject **`core.js` first, then `sites/netflix.com.js`** (read both files, two
  `addScriptTag({content})` calls). Behavior/assertions should remain unchanged
  (initial `tab-home`, arrow nav, overlay scoping) because Netflix config replicates
  the old algorithm.
- `tests/visual_indicator.spec.js`: loads the real extension on `test.html`; should
  keep passing — core's `focusin` handler shows the indicator with green
  `rgb(76, 175, 80)` border (default `indicatorColor`). Verify after implementation.
- Run: `npm test` (Playwright; needs `npx playwright install chromium`). Tests run
  headful — confirm they work in this environment.

### 7. Docs  *(DONE)*
- `README.md`: update goal (universal, not streaming-only), button map
  (A=Enter/click, B=Escape/back, X=drill into nested, right stick=scroll), features.
- `DEVELOPMENT.md`: document the new central-engine architecture, the
  `registerSite` config schema, generic focusable detection, overlay scoping,
  outermost-vs-innermost nesting + X drill-in, right-stick scrolling, and the
  "core owns activation / gamepad.js is pure input" decision.

---

## Important decisions / gotchas
- **Single activation source**: gamepad.js no longer dispatches synthetic key events;
  core does all clicks. Prevents double-activation when an element is natively focused.
- **`script.async = false`** is required so `core.js` defines `registerSite` before a
  site config runs.
- **Netflix parity**: keep `nesting: 'innermost'` + `captureKeyboard: true` so the
  existing `navigation.spec.js` assertions still hold. Generic default is
  `outermost` + no keyboard capture (don't hijack arrow keys on arbitrary sites).
- **`autoSelect: true`** preserves the "always selected" UX; both existing tests
  remain compatible (netflix expects initial `tab-home`; visual test focuses manually).
- **`cursor:pointer` heuristic** can over-select; it's pruned by the nesting filter and
  disabled for Netflix. Revisit if noisy on real sites.
- Mock modal in `tests/netflix-mock.html` uses id `preview-modal`; all its interactive
  elements are id-prefixed `modal-` (assertions rely on this).

## Suggested implementation order
1. `core.js`  2. `sites/netflix.com.js`  3. `sites/default.js`  4. `content.js`
5. `manifest.json`  6. tests  7. docs → then `npm test`.

---

# Phase 2 — Shoulder history navigation & right-trigger cursor mode

> Goal: add two universal (all-sites) gamepad behaviours on top of the central
> engine. These are generic and live in `gamepad.js` (input) + `core.js` (engine);
> no per-site config is required, though the config schema may gain optional toggles.

## Target behavior

### A. Shoulder buttons → browser history
- **LB (button 4)**: browser **back** navigation (`history.back()`).
- **RB (button 5)**: browser **forward** navigation (`history.forward()`).
- Edge-triggered (fire once per press). Works on any site.

### B. Right trigger (RT, button 7) → mouse / cursor mode
- While **RT is held**, the extension enters **cursor mode**:
  - **Left stick** moves a **virtual mouse cursor** around the viewport
    (continuous movement) instead of changing the selected element.
  - **A (button 0)** acts as a **mouse click** at the cursor position
    (not Enter/activate-selection).
- When RT is **released**, behaviour returns to normal: left stick navigates the
  selection, A activates the current element.
- A visible cursor indicator is shown while in cursor mode and hidden when it ends.

---

## 1. `gamepad.js` — input changes  *(DONE)*

**New button constants**
```js
const BTN_LB = 4;   // browser back
const BTN_RB = 5;   // browser forward
const BTN_RT = 7;   // right trigger -> cursor mode modifier (analog)
```

**Shoulder buttons (edge-triggered)**
- `if (edge(BTN_LB, isDown(BTN_LB))) sendKey('NavBack');`
- `if (edge(BTN_RB, isDown(BTN_RB))) sendKey('NavForward');`

**RT modifier / cursor mode**
- Triggers are analog: treat pressed when `gp.buttons[BTN_RT].value > 0.5`
  (fall back to `.pressed`). Track `rtActive` each frame.
- On RT **rising edge** → `sendKey('CursorOn')`; on **falling edge** →
  `sendKey('CursorOff')`. (Lets core show/hide the cursor and switch modes.)
- **Cursor movement vs navigation (mutually exclusive):**
  - When `rtActive`:
    - Do **not** emit `Arrow*` from the left stick.
    - Emit continuous `COUCH_BROWSER_CURSOR {dx, dy}` from axes 0/1 with a deadzone
      (`CURSOR_DEADZONE ≈ 0.15`) and speed (`CURSOR_SPEED ≈ 12 px/frame` at full
      deflection). Mirror the existing right-stick scroll pattern.
  - When not `rtActive`: keep the current left-stick → edge-triggered `Arrow*`.
- **A button in cursor mode:** when `rtActive`, `edge(BTN_A)` →
  `sendKey('MouseClick')` instead of `sendKey('Enter')`.
- **Edge bookkeeping:** when RT toggles, reset `lastLeftAxisX/Y` to 0 so switching
  modes doesn't emit a spurious arrow edge on the next frame.
- Right stick scrolling (`COUCH_BROWSER_SCROLL`) is unaffected and works in both modes.

**Message summary (new):**
- `COUCH_BROWSER_KEY` keys added: `NavBack`, `NavForward`, `CursorOn`, `CursorOff`,
  `MouseClick`.
- New message type `COUCH_BROWSER_CURSOR` `{ dx, dy }` (continuous, like `COUCH_BROWSER_SCROLL`).

## 2. `core.js` — engine changes  *(DONE)*

**Config (optional toggles, default on)** — extend `DEFAULT_CONFIG`:
```js
historyNavigation: true,   // LB/RB browser back/forward
cursorMode: true           // RT cursor + mouse click
```
(Sites can opt out if shoulder/trigger buttons conflict with site shortcuts.)

**History navigation**
- `COUCH_BROWSER_KEY` `NavBack` → `if (config.historyNavigation) window.history.back();`
- `COUCH_BROWSER_KEY` `NavForward` → `if (config.historyNavigation) window.history.forward();`
- Only act in the top frame (`window.self === window.top`) to avoid an iframe
  navigating its own subframe history unexpectedly. (Verify against test needs.)

**Virtual cursor state**
- Track `cursorActive` (bool) and `cursorX`, `cursorY` (viewport coords). Initialize
  to the viewport center, or to the center of `currentElement` if one is selected.
- `#couch-browser-cursor` element: a `position: fixed`, `pointer-events: none`,
  high-`z-index` pointer (small circle / arrow SVG). Created lazily like the other
  indicators; only added in the top frame.

**Message handling**
- `CursorOn` (guard `config.cursorMode`): set `cursorActive = true`, ensure the
  cursor element exists, position it at `cursorX/cursorY`, show it. Optionally hide
  the selection indicator while in cursor mode.
- `CursorOff`: set `cursorActive = false`, hide the cursor element, restore the
  selection indicator (`updateSelectionIndicator(currentElement)`).
- `COUCH_BROWSER_CURSOR {dx, dy}`: if `cursorActive`, update `cursorX/Y` clamped to
  `[0, innerWidth] × [0, innerHeight]`, reposition the cursor element. (Ignore if
  not active.)
- `MouseClick`: if `cursorActive`, resolve target via
  `document.elementFromPoint(cursorX, cursorY)` and dispatch a realistic click
  sequence on it: `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`
  (each `{ bubbles: true, cancelable: true, composed: true, clientX: cursorX,
  clientY: cursorY }`). Guard against `null` / `body` / `html`.

**Interaction notes**
- In cursor mode, `Enter` is never sent (A maps to `MouseClick`), so
  `activateCurrent()` is untouched.
- The `focusin` sync and selection indicator should not fight the cursor; hiding the
  selection indicator while `cursorActive` keeps the UI unambiguous.
- Keep the cursor positioned correctly on `scroll`/`resize` — it's viewport-fixed, so
  no recompute needed, but `elementFromPoint` already uses viewport coords.

## 3. `gamepad.js` — connection indicator removed

## 4. Tests  *(DONE — `tests/cursor_history.spec.js`; all 4 specs pass)*
- New spec (e.g. `tests/cursor_history.spec.js`) or additions to `navigation.spec.js`:
  - **History:** stub/inject and verify `NavBack`/`NavForward` call
    `history.back()`/`forward()` (spy on `window.history`), or do a real two-page
    `file://` navigation and assert `location` changes.
  - **Cursor:** send `CursorOn`, a few `COUCH_BROWSER_CURSOR` moves to position the cursor
    over a known element, then `MouseClick`; assert a click handler on the element
    under the cursor fired and that `#couch-browser-cursor` is visible.
  - Confirm `CursorOff` hides the cursor and restores selection navigation.
- Expose any needed hooks on `window.CouchBrowserSiteLogic` for assertions (e.g.
  `get cursorActive`, `get cursorPosition`) if direct DOM checks are insufficient.
- Run headful via `npm test`; keep existing two specs green.

## 5. Docs  *(DONE)*
- `README.md`: extend the button map — LB = back, RB = forward, RT (hold) = cursor
  mode (left stick moves cursor, A = mouse click).
- `DEVELOPMENT.md`: document the new messages (`NavBack`, `NavForward`, `CursorOn`,
  `CursorOff`, `MouseClick`, `COUCH_BROWSER_CURSOR`), the RT modifier model (mutually
  exclusive stick mapping), the virtual cursor element, the synthesized click
  sequence via `elementFromPoint`, and the new optional config toggles.

---

## Phase 2 — decisions / gotchas
- **Analog triggers:** RT (and LT) report a `value` in `[0,1]`; use a threshold, not
  just `.pressed`, for reliable detection across controllers.
- **Mode is held, not toggled:** cursor mode is active only while RT is down. Reset
  left-stick edge state on mode change to avoid a stray navigation step.
- **Single click source stays in core:** gamepad.js still dispatches no DOM events;
  it only sends `MouseClick` intent. core synthesizes the click at the cursor point.
- **`elementFromPoint` needs `pointer-events: none`** on the cursor element, or it
  will hit the cursor itself.
- **History in frames:** restrict back/forward to the top frame to avoid surprising
  subframe history behaviour.
- **Config opt-out:** `historyNavigation` / `cursorMode` default on; allow sites to
  disable if shoulder/trigger inputs clash with site-specific shortcuts.

## Phase 2 — suggested implementation order
1. `gamepad.js` (new buttons, RT mode, new messages)
2. `core.js` (history nav, virtual cursor, MouseClick)
3. tests  4. docs → then `npm test`.

---

# Phase 3 � Right-trigger tab switching  *(DONE)*

## Target behavior
While the right trigger (RT) is held, the shoulder buttons switch the active browser
tab instead of navigating history:
- **LB (4)** ? previous tab (wraps to last at the start)
- **RB (5)** ? next tab (wraps to first at the end)

When RT is *not* held the shoulders keep their Phase 2 behavior (browser back/forward).

## Implementation  *(DONE � 	ests/tab_switch.spec.js; all 8 specs pass)*
1. `gamepad.js`: while RT is active, LB/RB post `COUCH_BROWSER_TAB { dir: 'prev'|'next' }`
   instead of `NavBack`/`NavForward`.
2. `content.js`: a **top-frame-only** listener relays `COUCH_BROWSER_TAB` to the
   background worker via `chrome.runtime.sendMessage` (avoids iframe duplicates).
3. `background.js` (new service worker): owns `chrome.tabs` � sorts the current
   window's tabs by `index`, finds the active one, activates the previous/next tab
   with wraparound via `chrome.tabs.update(id, { active: true })`.
4. `manifest.json`: added `"tabs"` permission and `background.service_worker`.

## Sensitivity fix � switch cooldown  *(DONE)*
## Sensitivity fix — input cooldown  *(DONE)*
A single button press often jumped several tabs or closed multiple tabs (button bounce
and/or the same intent arriving from multiple relays). Fixed with a **200 ms cooldown**
(`INPUT_COOLDOWN_MS`) in `background.js`: requests arriving within that window of
the last action are ignored. Debouncing at this single chokepoint is robust
regardless of how many duplicate messages are produced upstream.

## Phase 3 � decisions / gotchas
- **`chrome.tabs` is background-only:** neither content scripts nor the page Main
  World can switch tabs, hence the relay ? service worker design.
- **Top-frame-only relay:** prevents iframes from each firing a switch.
- **Debounce in the worker, not the poller:** the single chokepoint catches duplicates
  from frames/relays and physical button bounce alike.
- **Test reliability:** `visibilityState` is only reliable for the *newly visible*
  tab in headful mode; assert the target tab *becomes* visible (a missed/over-shot
  switch makes the `waitForFunction` time out) rather than asserting others hidden.
