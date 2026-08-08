(function() {
    // Runs in the page's Main World. The Gamepad API does not expose connected
    // gamepads to content-script isolated worlds, so polling must happen here.
    //
    // This script is pure input: it polls the gamepad and forwards intent to the
    // central navigation engine (core.js) via window.postMessage. It deliberately
    // does NOT perform navigation or dispatch synthetic DOM key events itself, so
    // that all activation logic lives in one place and never fires twice.
    console.log('Couch Browser: Gamepad polling loaded in ' + (window.self === window.top ? 'top frame' : 'iframe'));

    // Standard gamepad button indices.
    const BTN_A = 0;       // Enter / click (mouse click while in cursor mode)
    const BTN_B = 1;       // Escape / back
    const BTN_X = 2;       // Drill into nested interactive elements
    const BTN_Y = 3;       // Toggle default mode with RT; reload with LT
    const BTN_LB = 4;      // Browser back
    const BTN_RB = 5;      // Browser forward
    const BTN_RT = 7;      // Right trigger: invert the default mode while held
    const BTN_LT = 6;      // Left trigger: virtual keyboard shift
    const BTN_DPAD_UP = 12;
    const BTN_DPAD_DOWN = 13;
    const BTN_DPAD_LEFT = 14;
    const BTN_DPAD_RIGHT = 15;

    const AXIS_THRESHOLD = 0.5;   // left stick -> directional navigation threshold
    const NAV_REPEAT_DELAY = 350; // ms before a held stick starts repeating
    const NAV_REPEAT_INTERVAL = 120; // ms between repeated navigation steps
    const SCROLL_DEADZONE = 0.15; // right stick -> scrolling (continuous)
    const SCROLL_SPEED = 1080;    // pixels per second at full deflection
    const TRIGGER_THRESHOLD = 0.5;// analog trigger considered "pressed" above this
    const CURSOR_DEADZONE = 0.15; // left stick -> cursor movement (cursor mode)
    const CURSOR_SPEED = 12;      // cursor pixels per frame at full deflection

    const prevButtons = {};
    let leftNavDirectionX = 0;
    let leftNavDirectionY = 0;
    let leftNavNextRepeatX = 0;
    let leftNavNextRepeatY = 0;
    let lastRightAxisX = 0;
    let lastRightAxisY = 0;
    let lastPollTime = null;
    let defaultMode = 'cursor'; // persisted default; RT temporarily inverts it
    let cursorMode = false;         // effective mode after applying RT
    let shiftMode = false;

    function edge(index, pressed) {
        const was = !!prevButtons[index];
        prevButtons[index] = pressed;
        const isEdge = pressed && !was;
        if (isEdge) console.log(`Couch Browser: Edge detected for button ${index}`);
        return isEdge;
    }

    function pollGamepad() {
        const now = performance.now();
        // Scale scrolling by elapsed time rather than animation-frame count.
        // Heavy pages can render at a lower frame rate, which otherwise makes
        // the same stick position physically scroll more slowly.
        const elapsed = lastPollTime === null
            ? 1 / 60
            : Math.min(Math.max(now - lastPollTime, 0), 50) / 1000;
        lastPollTime = now;

        let gamepads = [];
        try {
            gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        } catch (e) {
            // Access to gamepad might be disallowed by permissions policy in some iframes.
            // console.error('Couch Browser: Failed to get gamepads', e);
        }

        let gp = null;
        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i]) { gp = gamepads[i]; break; }
        }

        // Notify core.js about gamepad connection status
        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_CONNECTION',
            connected: !!gp
        }, '*');

        if (gp) {
            const isDown = (i) => gp.buttons[i] ? gp.buttons[i].pressed : false;
            const analog = (i) => gp.buttons[i] ? gp.buttons[i].value : 0;

            const rtActive = analog(BTN_RT) > TRIGGER_THRESHOLD || isDown(BTN_RT);
            edge(BTN_RT, rtActive);
            applyMode(defaultMode === 'cursor' ? !rtActive : rtActive);

            const ltActive = analog(BTN_LT) > TRIGGER_THRESHOLD || isDown(BTN_LT);
            if (edge(BTN_LT, ltActive)) {
                shiftMode = true;
                sendKey('ShiftOn');
            } else if (!ltActive && shiftMode) {
                shiftMode = false;
                sendKey('ShiftOff');
            }

            // A: click element under cursor in cursor mode, else activate selection.
            if (edge(BTN_A, isDown(BTN_A))) {
                if (!cursorMode && window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) sendKey('KeyboardActivate');
                else sendKey(cursorMode ? 'MouseClick' : 'Enter');
            }
            if (edge(BTN_B, isDown(BTN_B))) {
                console.log('Couch Browser: B button pressed, cursorMode:', cursorMode);
                if (window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
                    sendKey('Escape');
                } else if (cursorMode) sendTabClose(); else sendKey('Escape');
            }
            if (edge(BTN_X, isDown(BTN_X))) {
                sendKey(window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen() ? 'Enter' : 'PadX');
            }
            if (edge(BTN_Y, isDown(BTN_Y))) {
                if (window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
                    sendKey('KeyboardBackspace');
                } else if (rtActive) {
                    defaultMode = defaultMode === 'navigation' ? 'cursor' : 'navigation';
                    applyMode(defaultMode === 'cursor' ? !rtActive : rtActive);
                    saveDefaultMode(defaultMode);
                } else if (ltActive) {
                    sendTabReload();
                }
            }

            // Shoulder buttons: browser history navigation, or — while the right
            // trigger is held (cursor mode) — switch to the previous/next tab.
            if (edge(BTN_LB, isDown(BTN_LB))) {
                if (cursorMode) sendTab('prev'); else sendKey('NavBack');
            }
            if (edge(BTN_RB, isDown(BTN_RB))) {
                if (cursorMode) sendTab('next'); else sendKey('NavForward');
            }

            if (edge(BTN_DPAD_UP, isDown(BTN_DPAD_UP))) sendKey('ArrowUp');
            if (edge(BTN_DPAD_DOWN, isDown(BTN_DPAD_DOWN))) sendKey('ArrowDown');
            if (edge(BTN_DPAD_LEFT, isDown(BTN_DPAD_LEFT))) sendKey('ArrowLeft');
            if (edge(BTN_DPAD_RIGHT, isDown(BTN_DPAD_RIGHT))) sendKey('ArrowRight');

            // Left stick: cursor movement in cursor mode, else directional navigation.
            const lx = gp.axes && gp.axes.length > 0 ? gp.axes[0] : 0;
            const ly = gp.axes && gp.axes.length > 1 ? gp.axes[1] : 0;

            if (cursorMode) {
                const cdx = Math.abs(lx) > CURSOR_DEADZONE ? lx * CURSOR_SPEED : 0;
                const cdy = Math.abs(ly) > CURSOR_DEADZONE ? ly * CURSOR_SPEED : 0;
                if (cdx !== 0 || cdy !== 0) sendCursor(cdx, cdy);
            } else {
                // Unlike the D-pad, a held stick direction repeats navigation.
                navigateWithHeldStick(lx, 'x', now);
                navigateWithHeldStick(ly, 'y', now);
            }

            // Right stick -> continuous scrolling (works in both modes).
            const rx = gp.axes && gp.axes.length > 2 ? gp.axes[2] : 0;
            const ry = gp.axes && gp.axes.length > 3 ? gp.axes[3] : 0;
            const keyboardOpen = window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen();
            if (keyboardOpen) {
                if (rx > AXIS_THRESHOLD && lastRightAxisX <= AXIS_THRESHOLD) sendKey('InputArrowRight');
                else if (rx < -AXIS_THRESHOLD && lastRightAxisX >= -AXIS_THRESHOLD) sendKey('InputArrowLeft');
                if (ry > AXIS_THRESHOLD && lastRightAxisY <= AXIS_THRESHOLD) sendKey('InputArrowDown');
                else if (ry < -AXIS_THRESHOLD && lastRightAxisY >= -AXIS_THRESHOLD) sendKey('InputArrowUp');
                lastRightAxisX = rx;
                lastRightAxisY = ry;
            } else {
                const scrollStep = SCROLL_SPEED * elapsed;
                const dx = Math.abs(rx) > SCROLL_DEADZONE ? rx * scrollStep : 0;
                const dy = Math.abs(ry) > SCROLL_DEADZONE ? ry * scrollStep : 0;
                if (dx !== 0 || dy !== 0) sendScroll(dx, dy);
                lastRightAxisX = 0;
                lastRightAxisY = 0;
            }
        }
        requestAnimationFrame(pollGamepad);
    }

    function sendKey(key) {
        if (key === 'NavBack') {
            window.history.back();
            return;
        }
        if (key === 'NavForward') {
            window.history.forward();
            return;
        }
        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_KEY',
            key: key
        }, '*');
    }

    function applyMode(nextCursorMode) {
        if (cursorMode === nextCursorMode) return;
        cursorMode = nextCursorMode;
        console.log('Couch Browser: cursorMode', cursorMode ? 'ON' : 'OFF');
        sendKey(cursorMode ? 'CursorOn' : 'CursorOff');
        // Avoid a stray navigation step when switching modes.
        resetLeftStickNavigation();
    }

    function resetLeftStickNavigation() {
        leftNavDirectionX = 0;
        leftNavDirectionY = 0;
        leftNavNextRepeatX = 0;
        leftNavNextRepeatY = 0;
    }

    function navigateWithHeldStick(value, axis, now) {
        const direction = value > AXIS_THRESHOLD ? 1 : value < -AXIS_THRESHOLD ? -1 : 0;
        const key = axis === 'x'
            ? (direction > 0 ? 'ArrowRight' : 'ArrowLeft')
            : (direction > 0 ? 'ArrowDown' : 'ArrowUp');
        const currentDirection = axis === 'x' ? leftNavDirectionX : leftNavDirectionY;
        const nextRepeat = axis === 'x' ? leftNavNextRepeatX : leftNavNextRepeatY;

        if (direction === 0) {
            if (axis === 'x') {
                leftNavDirectionX = 0;
                leftNavNextRepeatX = 0;
            } else {
                leftNavDirectionY = 0;
                leftNavNextRepeatY = 0;
            }
            return;
        }

        if (direction !== currentDirection) {
            sendKey(key);
            if (axis === 'x') {
                leftNavDirectionX = direction;
                leftNavNextRepeatX = now + NAV_REPEAT_DELAY;
            } else {
                leftNavDirectionY = direction;
                leftNavNextRepeatY = now + NAV_REPEAT_DELAY;
            }
        } else if (now >= nextRepeat) {
            sendKey(key);
            if (axis === 'x') leftNavNextRepeatX = now + NAV_REPEAT_INTERVAL;
            else leftNavNextRepeatY = now + NAV_REPEAT_INTERVAL;
        }
    }

    function saveDefaultMode(mode) {
        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_DEFAULT_MODE_SET',
            mode: mode
        }, '*');
    }

    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.source !== 'couch-browser-extension' || data.type !== 'COUCH_BROWSER_DEFAULT_MODE') return;
        defaultMode = data.mode === 'cursor' ? 'cursor' : 'navigation';
        window.CouchBrowserDefaultMode = defaultMode;
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = Array.from(gamepads || []).find(Boolean);
        const rtActive = !!(gp && gp.buttons[BTN_RT] && (gp.buttons[BTN_RT].pressed || gp.buttons[BTN_RT].value > TRIGGER_THRESHOLD));
        applyMode(defaultMode === 'cursor' ? !rtActive : rtActive);
    });

    function sendScroll(dx, dy) {
        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_SCROLL',
            dx: dx,
            dy: dy
        }, '*');
    }

    function sendCursor(dx, dy) {
        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_CURSOR',
            dx: dx,
            dy: dy
        }, '*');
    }

    function sendTab(dir) {
        // Tab switching needs the chrome.tabs API, which only the background
        // service worker can call. content.js relays this to the background.
        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_TAB',
            dir: dir
        }, '*');
    }

    function sendTabClose() {
        console.log('Couch Browser: Sending COUCH_BROWSER_TAB_CLOSE');
        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_TAB_CLOSE'
        }, '*');
    }

    function sendTabReload() {
        console.log('Couch Browser: Sending COUCH_BROWSER_TAB_RELOAD');
        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_TAB_RELOAD'
        }, '*');
    }

    window.addEventListener("gamepadconnected", (e) => {
        console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.",
            e.gamepad.index, e.gamepad.id,
            e.gamepad.buttons.length, e.gamepad.axes.length);
    });

    pollGamepad();
})();
