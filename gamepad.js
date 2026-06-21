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
    const BTN_A = 0;       // Enter / click  (mouse click while in cursor mode)
    const BTN_B = 1;       // Escape / back
    const BTN_X = 2;       // Drill into nested interactive elements
    const BTN_LB = 4;      // Browser back
    const BTN_RB = 5;      // Browser forward
    const BTN_RT = 7;      // Right trigger: hold for cursor (mouse) mode
    const BTN_DPAD_UP = 12;
    const BTN_DPAD_DOWN = 13;
    const BTN_DPAD_LEFT = 14;
    const BTN_DPAD_RIGHT = 15;

    const AXIS_THRESHOLD = 0.5;   // left stick -> directional navigation (edge triggered)
    const SCROLL_DEADZONE = 0.15; // right stick -> scrolling (continuous)
    const SCROLL_SPEED = 18;      // pixels per frame at full deflection
    const TRIGGER_THRESHOLD = 0.5;// analog trigger considered "pressed" above this
    const CURSOR_DEADZONE = 0.15; // left stick -> cursor movement (cursor mode)
    const CURSOR_SPEED = 12;      // cursor pixels per frame at full deflection

    const prevButtons = {};
    let lastLeftAxisX = 0;
    let lastLeftAxisY = 0;
    let cursorMode = false;       // true while the right trigger is held

    function edge(index, pressed) {
        const was = !!prevButtons[index];
        prevButtons[index] = pressed;
        const isEdge = pressed && !was;
        if (isEdge) console.log(`Couch Browser: Edge detected for button ${index}`);
        return isEdge;
    }

    function pollGamepad() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

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

            // Right trigger (analog) enables cursor (mouse) mode while held.
            const rtActive = analog(BTN_RT) > TRIGGER_THRESHOLD || isDown(BTN_RT);
            if (edge(BTN_RT, rtActive)) {
                cursorMode = true;
                console.log('Couch Browser: cursorMode ON');
                sendKey('CursorOn');
                // Avoid a stray navigation edge when switching modes.
                lastLeftAxisX = 0;
                lastLeftAxisY = 0;
            } else if (!rtActive && cursorMode) {
                cursorMode = false;
                console.log('Couch Browser: cursorMode OFF');
                sendKey('CursorOff');
                lastLeftAxisX = 0;
                lastLeftAxisY = 0;
            }

            // A: click element under cursor in cursor mode, else activate selection.
            if (edge(BTN_A, isDown(BTN_A))) sendKey(cursorMode ? 'MouseClick' : 'Enter');
            if (edge(BTN_B, isDown(BTN_B))) {
                console.log('Couch Browser: B button pressed, cursorMode:', cursorMode);
                if (cursorMode) sendTabClose(); else sendKey('Escape');
            }
            if (edge(BTN_X, isDown(BTN_X))) sendKey('PadX');

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
                // Edge triggered like the D-pad.
                if (lx > AXIS_THRESHOLD && lastLeftAxisX <= AXIS_THRESHOLD) sendKey('ArrowRight');
                else if (lx < -AXIS_THRESHOLD && lastLeftAxisX >= -AXIS_THRESHOLD) sendKey('ArrowLeft');

                if (ly > AXIS_THRESHOLD && lastLeftAxisY <= AXIS_THRESHOLD) sendKey('ArrowDown');
                else if (ly < -AXIS_THRESHOLD && lastLeftAxisY >= -AXIS_THRESHOLD) sendKey('ArrowUp');

                lastLeftAxisX = lx;
                lastLeftAxisY = ly;
            }

            // Right stick -> continuous scrolling (works in both modes).
            const rx = gp.axes && gp.axes.length > 2 ? gp.axes[2] : 0;
            const ry = gp.axes && gp.axes.length > 3 ? gp.axes[3] : 0;
            const dx = Math.abs(rx) > SCROLL_DEADZONE ? rx * SCROLL_SPEED : 0;
            const dy = Math.abs(ry) > SCROLL_DEADZONE ? ry * SCROLL_SPEED : 0;
            if (dx !== 0 || dy !== 0) sendScroll(dx, dy);
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

    function sendScroll(dx, dy) {
        if (dx !== 0 || dy !== 0) {
            window.scrollBy(dx, dy);
        }
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

    window.addEventListener("gamepadconnected", (e) => {
        console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.",
            e.gamepad.index, e.gamepad.id,
            e.gamepad.buttons.length, e.gamepad.axes.length);
    });

    pollGamepad();
})();
