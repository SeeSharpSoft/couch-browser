# Development Guide - Couch Browser

Couch Browser is a Chrome extension that provides **universal gamepad navigation for any
webpage**. A central navigation engine (`core.js`) owns all navigation, activation,
overlay scoping, drill-in and indicator logic. Site-specific files only supply
selectors and small behaviour tweaks via a registration API.

## Architecture Overview

Scripts run in two worlds, plus a background service worker:

- **Isolated World** — `content.js` (the content script). It injects the Main World
  scripts in order, detects the current domain for dynamic site loading, and relays
  `COUCH_BROWSER_TAB` intents to the background worker.
- **Main World** — the injected scripts that interact with the page:
  - `gamepad.js` — **pure input**. Polls the Gamepad API and forwards intent.
  - `core.js` — **central navigation engine**. Consumes the input and drives the DOM.
  - `sites/<domain>.js` (fallback `sites/default.js`) — **config only**. Calls
    `window.CouchBrowser.registerSite(config)`.
- **Background service worker** — `background.js`. Owns the `chrome.tabs` API and
  performs tab switching (which content/page scripts cannot do).

Injection order is significant and enforced with `script.async = false` so that
`core.js` defines `window.CouchBrowser.registerSite` before any site config runs:

```
gamepad.js  →  core.js  →  sites/<domain>.js | sites/default.js
```

### Why a Main World engine

The Gamepad API (`navigator.getGamepads()`) does **not** expose connected gamepads to
content-script isolated worlds in Chrome — it returns an array of `null`s and
`gamepadconnected` never fires there. Therefore both gamepad polling and the
navigation engine run in the page's Main World, injected via `<script>` tags (which
also complies with strict CSPs that block `eval`).

### Input / engine separation (single activation source)

`gamepad.js` is deliberately **pure input**. It performs no navigation and dispatches
no synthetic DOM key events. It only posts messages via `window.postMessage` with a
`source: 'couch-browser-extension'` marker:

- `COUCH_BROWSER_KEY` with `key` ∈ `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight`
  (left stick held-repeat + D-pad edge-triggered), `Enter` (A), `Escape` (B), `PadX` (X),
  `NavBack` (LB), `NavForward` (RB), `CursorOn` / `CursorOff` (right trigger
  pressed/released) and `MouseClick` (A while the trigger is held).
- `COUCH_BROWSER_SCROLL` with `{ dx, dy }` (right stick, continuous, deadzone 0.15,
  ~18 px/frame at full deflection).
- `COUCH_BROWSER_CURSOR` with `{ dx, dy }` (left stick in cursor mode, continuous,
  deadzone 0.15, ~12 px/frame at full deflection).
- `COUCH_BROWSER_TAB` with `{ dir: 'prev' | 'next' }` (LT held + LB/RB). Unlike
  the others, this is consumed by `content.js` and relayed to the background service
  worker, not by `core.js`.
- `COUCH_BROWSER_TAB_RELOAD` (left trigger + Y, when the virtual keyboard is closed). This is consumed by `content.js`
  and relayed to the background service worker, not by `core.js`.

The right trigger (button 7) is analog: it is treated as held when its `value`
exceeds 0.5. The default mode is cursor mode unless changed with RT + Y, and is persisted as either navigation or cursor mode. While RT is held,
the effective mode is inverted: the left stick emits `COUCH_BROWSER_CURSOR` instead of `Arrow*`,
and A emits `MouseClick` instead of `Enter`. RT + Y toggles the persisted default mode.
While LT is held, B closes the current tab, Y reloads it, and LB/RB switch tabs when
the virtual keyboard is closed. The two stick mappings are
mutually exclusive. On a mode switch the left-stick edge state is reset so no stray
navigation step is emitted.

`core.js` is the **single source of activation**: it owns all clicks, Escape
dispatch, scrolling and indicator updates. This prevents double-activation that would
occur if both a synthetic key event and an engine click fired for the same press.

## `core.js` — Central Navigation Engine

### Registration API

```js
window.CouchBrowser = window.CouchBrowser || {};
window.CouchBrowser.registerSite(config); // merges over DEFAULT_CONFIG and (re)initializes
```

`core.js` is a **singleton** per Main World (guarded by `window.CouchBrowser.__engineLoaded`).
If injected more than once, later copies do nothing and defer to the existing engine;
their site config still applies through `registerSite`. Registration supports **late
arrival** — config may be registered before or after `DOMContentLoaded`, and the engine
re-runs initialization either way.

### Config schema (`DEFAULT_CONFIG`)

| Key | Default | Purpose |
| --- | --- | --- |
| `name` | `'default'` | Label for logging. |
| `indicatorColor` | `'#4CAF50'` | Selection highlight border/glow color. |
| `extraSelectors` | `[]` | Extra focusable selectors unioned with the base set. |
| `excludeSelectors` | `[]` | Selectors to remove from the candidate set. |
| `overlaySelectors` | dialog/modal/popup set | Elements that, when visible, scope navigation. |
| `closeSelectors` | close-button set | Clicked on `B` to dismiss an overlay. |
| `getContainer` | `null` | `(el) => Element\|null`; chooses the highlighted container. |
| `firstElementSelectors` | `[]` | Preferred initial selection (in order). |
| `nesting` | `'outermost'` | `'outermost'` or `'innermost'` candidate pruning. |
| `useCursorPointer` | `true` | Include `cursor:pointer` elements as candidates. |
| `captureKeyboard` | `false` | Intercept real arrow keys for navigation. |
| `autoSelect` | `true` | Auto-select the first element on load. |
| `historyNavigation` | `true` | LB/RB drive browser back/forward. |
| `cursorMode` | `true` | Right trigger enables the virtual mouse cursor. |

### Generic focusable detection

The engine queries a generic base selector set (links, buttons, inputs, selects,
textareas, `summary`, `label[for]`, interactive ARIA roles, `[contenteditable="true"]`,
`[onclick]`, `[tabindex]:not([tabindex="-1"])`), unioned with `config.extraSelectors`
and minus `config.excludeSelectors`. `isVisible()` filters out zero-size,
`display:none`, `visibility:hidden`, `pointer-events:none` and fully transparent
elements.

When `useCursorPointer` is on, elements with a computed `cursor: pointer` are also
considered candidates (many sites attach handlers to plain styled elements); the
nesting filter prunes the noise.

### Overlay scoping

`getActiveOverlay()` queries `overlaySelectors`, keeps visible ones, prefers the
outermost (not contained by another overlay), then the highest `z-index`. While an
overlay is open, navigation is restricted to elements inside it, and focus that lands
behind the overlay is ignored.

### Nesting and drill-in (X)

- `getScope()` resolves the navigation root with priority **active overlay > valid
  drill scope > document**. (An overlay opening above a drill scope wins.)
- **Nesting filter:**
  - `outermost` (generic default): keep an element only if no other candidate
    contains it — a clickable image is selected as a whole; inner links are hidden
    until you drill in.
  - `innermost` (Netflix): keep an element only if it does not contain another
    candidate — leaf anchors, preserving the original Netflix behaviour.
- **Drill-in (`PadX` / X):** if the current element contains visible navigable
  children, `drillScope` is set to it and the first inner element is selected.
- **Drill-out (`Escape` / B):** clears `drillScope` and reselects the former
  container. `drillScope` is invalidated automatically if it is removed/hidden.

### Spatial navigation

`navigate(direction)` ports a cone-based scoring algorithm: for each candidate in the
chosen direction it computes `primary` (distance along the axis) and `cross` (distance
across it). A strict pass requires `cross <= primary * 1.5` and scores
`primary + cross * 3`; a relaxed fallback (`primary + cross * 2`, any element in the
direction) guarantees movement. The current selection is validated against the active
scope, visibility and document membership before navigating.

### Selection indicator

`updateSelectionIndicator()` positions a single absolutely-positioned `<div>`
(`#couch-browser-selection-indicator`) over the selected element, or over the element
returned by `config.getContainer(el)` when provided. The border/glow color is taken
from `config.indicatorColor` and re-applied on every (re)registration so theme changes
take effect even if the indicator already exists. `scroll`/`resize` listeners keep the
indicator aligned.

### Back behaviour (B / `Escape`)

B is a **contextual cancel/back**, not browser history navigation:

1. If a drill scope is active (and no overlay is above it) → drill back out.
2. Else if an overlay/popup is active → close it: click `config.closeSelectors`
   inside it, or, if no close button matches, dispatch `Escape` into the overlay so
   popups that close on Escape do.
3. Else → dispatch a real `Escape` `keydown`/`keyup` (`composed: true`) to the current
   element and `document` for site compatibility.

### Scrolling (`COUCH_BROWSER_SCROLL`)

The handler finds the nearest scrollable ancestor of the current element (computed
`overflow-x/y` of `auto`/`scroll` with actual overflow); otherwise it scrolls
`window`. After scrolling, the indicator is repositioned.

### Browser history navigation (LB / RB)

`COUCH_BROWSER_KEY` `NavBack` / `NavForward` call `window.history.back()` /
`window.history.forward()` when `config.historyNavigation` is enabled. History
navigation is restricted to the **top frame** (`window.self === window.top`) so an
iframe never drives its own subframe history unexpectedly. Browser history is driven
**only** by the shoulder buttons — the B button is a contextual cancel (see above) and
never navigates history.

### Tab switching (right trigger + LB / RB)

Switching browser tabs requires the `chrome.tabs` API, which is unavailable to
content scripts and the page's Main World. The flow is therefore relayed across
contexts:

1. While LT is held, `gamepad.js` posts `COUCH_BROWSER_TAB { dir }` on shoulder
   presses (instead of `NavBack`/`NavForward`).
2. `content.js` (isolated world, **top frame only** to avoid iframe duplicates)
   receives the window message and forwards it with `chrome.runtime.sendMessage`.
3. `background.js` (service worker) queries the current window's tabs, sorts them by
   strip `index`, and activates the previous/next tab (wrapping at the ends) via
   `chrome.tabs.update(id, { active: true })`.

To stop a single button press from triggering multiple actions (button bounce, plus the
same intent potentially arriving from multiple relays/frames), `background.js`
enforces a **200 ms cooldown** (`INPUT_COOLDOWN_MS`): requests that arrive
within that window of the last action are ignored. Debouncing at this single
chokepoint is robust regardless of how many duplicate messages upstream produced.

This requires the `"tabs"` permission and a `"background": { "service_worker" }`
entry in the manifest.

### Hiding the real OS cursor

As soon as any `couch-browser-extension` message arrives (i.e. the gamepad is in use), the
engine adds `couch-browser-gamepad-active` to `<html>` and injects a stylesheet setting
`cursor: none` on the page, so the real OS cursor stops showing and visually competing
with the gamepad selection. A genuine (`isTrusted`) `mousemove` removes the class,
restoring the cursor when the user takes over the mouse. The OS cursor cannot be moved
from JS, so it is hidden rather than repositioned; synthetic events (e.g. the cursor-
mode click) are untrusted and do not restore it.

### Virtual mouse cursor (right trigger)

When cursor mode is active, `gamepad.js` sends `CursorOn`:

- A `#couch-browser-cursor` element (a `position: fixed`, **`pointer-events: none`**,
  top-frame-only pointer) is shown. `pointer-events: none` is essential so
  `document.elementFromPoint` resolves to the page, not the cursor.
- The cursor starts at the center of the viewport whenever cursor mode is activated
  and is moved by `COUCH_BROWSER_CURSOR {dx, dy}` messages, clamped to the viewport.
- The selection indicator is hidden while in cursor mode to keep the UI unambiguous.

`MouseClick` resolves the element under the cursor via
`document.elementFromPoint(cursorX, cursorY)` and dispatches a realistic pointer/mouse
sequence (`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`) with
`composed: true` and `clientX/clientY` set to the cursor position. `CursorOff` hides
the cursor and restores selection navigation.

### Keyboard sync

- A `focusin` listener adopts focus changed by mouse/Tab as the current element
  (skipped during programmatic focus via `suppressFocusSync`, and ignored for focus
  behind an active overlay).
- A trusted `keydown` arrow handler runs **only** when `config.captureKeyboard` is
  true, and never while focus is in an input/textarea/contenteditable.

### Public API (used by tests)

```js
window.CouchBrowserSiteLogic = {
  update: () => updateSelectionIndicator(currentElement),
  navigate,
  get current() { return currentElement; },
  get cursorActive() { return cursorActive; },
  get cursorPosition() { return { x, y }; }
};
```

## Site Configurations

### `sites/default.js`

Registers an empty config — pure generic behaviour (`outermost` nesting,
`cursor:pointer` heuristic on, no keyboard capture, green indicator).

### `sites/netflix.com.js`

Registers Netflix-specific config:

- `indicatorColor: '#E50914'` (Netflix red).
- `nesting: 'innermost'` and `captureKeyboard: true` to reproduce the original
  Netflix navigation behaviour.
- `useCursorPointer: false` (Netflix's selector set is precise enough).
- `extraSelectors` / `overlaySelectors` / `closeSelectors` for Netflix's DOM.
- `firstElementSelectors` preferring the nav tabs, then the play button, then the
  first title card.
- `getContainer` highlighting the nearest semantic container (title-card-container,
  billboard-links, navigation-tab, nav-element, navigation-menu).

Selectors favour stable attributes (`data-uia`, ARIA roles/labels, structural
classes) and avoid Emotion/hash classes (e.g. `default-ltr-iqcdef-cache-*`), which are
build-variant and unstable.

## Project Structure

- `manifest.json`: Manifest V3 metadata. Declares the `"tabs"` permission and a
  background service worker; `content.js` is injected into all frames of all URLs;
  `gamepad.js`, `core.js` and `sites/*.js` are declared in `web_accessible_resources`.
- `content.js`: Isolated-world loader. Injects `gamepad.js`, then `core.js`, then the
  site config (`sites/<domain>.js` if it exists via a `HEAD` check, else
  `sites/default.js`), with `script.async = false` to preserve order. Also relays
  `COUCH_BROWSER_TAB` intents (top frame only) to the background worker.
- `gamepad.js`: Main World pure-input poller.
- `core.js`: Main World central navigation engine.
- `background.js`: Service worker that switches tabs via `chrome.tabs` on
  `COUCH_BROWSER_TAB` messages.
- `sites/`: Site configuration files (`default.js`, `<domain>.js`).
- `popup.html` / `popup.js`: Toolbar popup showing connection status.

## Dynamic Site Loading

`content.js` derives the domain from `window.location.hostname` (stripping `www.`) and
issues a `HEAD` request for `sites/<domain>.js`. If it exists, it is injected; otherwise
`sites/default.js` is used. All injected paths are declared in
`web_accessible_resources`.

## Testing

Automated tests use Playwright (headful — Chrome extensions only load in headful mode).

1. **Prerequisites**: Node.js installed.
2. **Setup**: `npm install`, then `npx playwright install chromium`.
3. **Run**: `npm test`.

Tests:

- `tests/navigation.spec.js`: loads `tests/netflix-mock.html`, injects **`core.js`
  then `sites/netflix.com.js`** (hostname-based loading can't match a `file://` URL),
  and asserts initial selection, arrow navigation across nav/billboard/rows, and
  overlay scoping (navigation stays inside `#preview-modal` while open).
- `tests/visual_indicator.spec.js`: loads the unpacked extension on `tests/test.html`
  and verifies the selection indicator appears with the default green border
  (`rgb(76, 175, 80)`) on focus.
- `tests/cursor_history.spec.js`: loads the unpacked extension and verifies (1)
  cursor mode — `CursorOn` shows `#couch-browser-cursor`, `COUCH_BROWSER_CURSOR` positions it over
  a button, `MouseClick` fires the button's click handler, `CursorOff` hides it; and
  (2) history — `NavBack` / `NavForward` move between two `file://` pages.
- `tests/fixes.spec.js`: verifies (1) gamepad input adds `couch-browser-gamepad-active`
  (real cursor hidden) and a genuine mouse move restores it; and (2) B/Escape closes
  an injected popup without changing the page URL.
- `tests/tab_switch.spec.js`: opens two tabs and verifies `COUCH_BROWSER_TAB` (prev/next)
  activates the adjacent tab via the background worker; a second test fires rapid
  presses and verifies the 200 ms cooldown activates only one tab.

> Note: because the loaded extension injects its own `core.js`, the singleton guard
> ensures the test-injected `core.js` defers to it; the injected site config still
> applies through `registerSite`.

### How to Test Locally (Manual)

1. Open `chrome://extensions/` and enable **Developer mode**.
2. **Load unpacked** and select the project folder.
3. Connect a gamepad and open any website.
4. Use the sticks/D-pad to navigate; A/B/X to activate/back/drill; shoulders for
   browser history; hold LT for browser actions such as tab switching. Hold RT for
   cursor/navigation mode switching. Open the console to see Couch Browser logs.

## Design Decisions

- **Polling with `requestAnimationFrame`**: low latency, aligned with the render cycle.
- **Pure-input gamepad layer**: keeps a single activation source in `core.js`.
- **`script.async = false`**: guarantees `registerSite` exists before site configs run.
- **Singleton engine**: prevents duplicate engines fighting over selection/focus.
- **Explicit selection state**: the engine tracks its own `currentElement` because many
  sites manage focus themselves and `.focus()` does not reliably update
  `document.activeElement` or fire focus events.
- **Generic default `outermost` + no keyboard capture**: avoids hijacking arrow keys on
  arbitrary pages; Netflix opts into `innermost` + `captureKeyboard` for parity.
- **Cursor mode is held, not toggled**: the virtual cursor is active only while the
  right trigger is down; A maps to a synthesized `MouseClick` (via `elementFromPoint`)
  rather than activating the current selection, keeping core the single click source.
- **History scoped to the top frame**: shoulder back/forward only act on the top-level
  document.
- **Tab switching lives in the background worker**: `chrome.tabs` is unavailable to
  content/page scripts, so the intent is relayed page → content script → background.
  The relay is top-frame only to avoid duplicate switches from iframes.
