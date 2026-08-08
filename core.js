(function() {
    // Couch Browser central navigation engine (Main World).
    //
    // This is the generic, site-agnostic navigation engine. It owns ALL
    // navigation, activation and indicator logic. gamepad.js is pure input and
    // forwards intent here via window.postMessage (COUCH_BROWSER_KEY / COUCH_BROWSER_SCROLL).
    //
    // Site-specific files in sites/ do not contain logic anymore; they only call
    // window.CouchBrowser.registerSite(config) to tweak selectors and behaviour.

    // Singleton guard: only one engine instance may exist per Main World. If the
    // engine is already loaded (e.g. injected twice), do nothing and let the
    // existing instance handle registerSite calls.
    window.CouchBrowser = window.CouchBrowser || {};
    if (window.CouchBrowser.__engineLoaded) return;
    window.CouchBrowser.__engineLoaded = true;

    console.log('Couch Browser: Core engine loaded in ' + (window.self === window.top ? 'top frame' : 'iframe'));

    const DEFAULT_CONFIG = {
        name: 'default',
        indicatorColor: '#4CAF50',
        extraSelectors: [],
        excludeSelectors: [],
        overlaySelectors: [
            '[role="dialog"]', '[aria-modal="true"]', 'dialog[open]',
            '.modal.show', '.modal[open]', '.popup', '.overlay'
        ],
        closeSelectors: 'button[aria-label*="close" i], [data-uia*="close" i], [aria-label*="Close" i], .close',
        getContainer: null,            // (el) => Element|null, for indicator placement
        firstElementSelectors: [],     // preferred initial selection
        nesting: 'outermost',          // 'outermost' | 'innermost'
        useCursorPointer: true,        // cursor:pointer heuristic on/off
        captureKeyboard: false,        // intercept real arrow keys for navigation
        autoSelect: true,              // auto-select first element on load
        historyNavigation: true,       // LB/RB -> browser back/forward
        cursorMode: true               // right trigger -> virtual mouse cursor
    };

    // Generic focusable base selectors. Site config adds extraSelectors and may
    // remove some via excludeSelectors.
    const BASE_SELECTORS = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'summary',
        'label[for]',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="menuitemcheckbox"]',
        '[role="menuitemradio"]',
        '[role="tab"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="option"]',
        '[contenteditable="true"]',
        '[onclick]',
        '[tabindex]:not([tabindex="-1"])'
    ];

    let config = Object.assign({}, DEFAULT_CONFIG);

    let selectionIndicator = null;
    // Virtual mouse cursor (active while the right trigger is held).
    let cursorEl = null;
    let cursorActive = false;
    let cursorX = 0;
    let cursorY = 0;
    // Our own source of truth for the selected element. We do NOT rely on
    // document.activeElement / focus events alone, because many sites manage
    // focus themselves and .focus() does not reliably move activeElement.
    let currentElement = null;

    // Selection state per layer. For now, we only track the document (main layer)
    // and the current active overlay.
    const selectionHistory = new Map(); // Scope element -> selected element
    // Element we have drilled into (X button). Navigation is scoped to it until
    // we drill back out (B button) or it disappears.
    let drillScope = null;
    // Guards against the focus listener fighting our programmatic focus() calls.
    let suppressFocusSync = false;
    let initialized = false;
    let isGamepadConnected = false;

    function getSelectorString() {
        return BASE_SELECTORS.concat(config.extraSelectors || []).join(',');
    }

    function isExcluded(el) {
        const ex = config.excludeSelectors || [];
        for (let i = 0; i < ex.length; i++) {
            try { if (el.matches(ex[i])) return true; } catch (e) {}
        }
        return false;
    }

    // Some controls (notably icon-only controls implemented as a span) have no
    // useful layout box of their own. Their SVG is positioned independently and
    // is the thing the user actually sees. Keep the element's box as the base
    // (so padding remains selectable), but include rendered visual descendants
    // when they extend beyond it or when the element has no usable dimensions.
    function getVisualBounds(el) {
        if (!el || !el.getBoundingClientRect) return null;

        const own = el.getBoundingClientRect();
        let left = own.left;
        let top = own.top;
        let right = own.right;
        let bottom = own.bottom;

        // These are the descendants that can have an independent visual box.
        // Avoid walking every descendant on every navigation pass.
        const visuals = el.querySelectorAll
            ? el.querySelectorAll('svg, img, video, canvas, object, iframe')
            : [];
        for (const visual of visuals) {
            const rect = visual.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            left = Math.min(left, rect.left);
            top = Math.min(top, rect.top);
            right = Math.max(right, rect.right);
            bottom = Math.max(bottom, rect.bottom);
        }

        return {
            left,
            top,
            right,
            bottom,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top)
        };
    }

    function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return false;
        
        // Viewport check: if it's completely outside the viewport, it's not visible for navigation.
        if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
            return false;
        }

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
        if (parseFloat(style.opacity || '1') === 0) return false;

        // Occlusion check: if the element is obscured by another element.
        // We check at multiple points to be more robust (center and near corners).
        const points = [
            { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            { x: rect.left + 5, y: rect.top + 5 },
            { x: rect.right - 5, y: rect.bottom - 5 }
        ];
        
        let isObscured = true;
        for (const p of points) {
            if (p.x >= 0 && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight) {
                const hit = document.elementFromPoint(p.x, p.y);
                if (!hit || el.contains(hit) || hit.contains(el)) {
                    isObscured = false;
                    break;
                }
                
                // If the hit element doesn't capture pointer events, it doesn't really obscure.
                const hitStyle = window.getComputedStyle(hit);
                if (hitStyle.pointerEvents === 'none') {
                    isObscured = false;
                    break;
                }

                // Selection indicator and cursor should never obscure.
                if (hit.id === 'couch-browser-selection-indicator' || hit.id === 'couch-browser-cursor') {
                    isObscured = false;
                    break;
                }
            } else {
                // If at least one point is inside viewport and not obscured, we are good.
                // If point is outside, we just ignore it for the occlusion check.
            }
        }

        return !isObscured;
    }

    function getActiveOverlay() {
        const sel = (config.overlaySelectors || []).join(',');
        if (!sel) return null;
        const candidates = document.querySelectorAll(sel);
        const visible = [];
        candidates.forEach(el => { if (isVisible(el)) visible.push(el); });
        if (visible.length === 0) return null;

        // Keep only the outermost modals (not contained within another modal).
        const outer = visible.filter(el => !visible.some(o => o !== el && o.contains(el)));
        const pool = outer.length ? outer : visible;

        // If several independent overlays exist, prefer the one stacked on top.
        let best = pool[0];
        let bestZ = -Infinity;
        pool.forEach(el => {
            const style = window.getComputedStyle(el);
            const z = parseInt(style.zIndex, 10);
            const zVal = isNaN(z) ? 0 : z;
            // Higher z-index is prioritized. If z-index is equal, the one later in the DOM is usually on top.
            if (zVal >= bestZ) {
                bestZ = zVal;
                best = el;
            }
        });
        return best;
    }

    function getScope() {
        // Overlay always wins (an overlay may open above a drill scope).
        const overlay = getActiveOverlay();
        if (overlay) return overlay;
        if (drillScope && document.contains(drillScope) && isVisible(drillScope)) return drillScope;
        drillScope = null;
        return document;
    }

    let lastScope = null;

    function checkScopeChange() {
        const root = getScope();
        if (root !== lastScope) {
            const oldScope = lastScope;
            lastScope = root;

            // Save the selection of the layer we are leaving.
            if (oldScope) {
                selectionHistory.set(oldScope, currentElement);
            }

            if (root !== document) {
                // Moving into a popup/overlay: select the first element.
                // If we have a saved selection for this specific root (e.g. it was open before),
                // we could restore it, but the requirement says "selects the first element".
                const first = getFirstNavigableElement(root);
                setCurrent(first);
            } else {
                // Moving back to the main document: restore its previous selection.
                const saved = selectionHistory.get(document);
                if (saved && document.contains(saved) && isVisible(saved)) {
                    setCurrent(saved);
                } else {
                    // Fallback if no saved selection or it's gone.
                    setCurrent(getFirstNavigableElement(document));
                }
            }

            // Cleanup selectionHistory for scopes that are no longer in the DOM.
            for (const [scope, el] of selectionHistory.entries()) {
                if (scope !== document && !document.contains(scope)) {
                    selectionHistory.delete(scope);
                }
            }
        }
    }

    function getNavigableElements(root) {
        root = root || document;
        const matches = root.querySelectorAll(getSelectorString());
        const seen = new Set();
        const list = [];

        const consider = (el) => {
            if (!el || seen.has(el)) return;
            if (el === root) return;               // never select the scope root itself
            if (!isVisible(el) || isExcluded(el)) return;
            seen.add(el);
            list.push(el);
        };

        matches.forEach(consider);

        // cursor:pointer heuristic: many sites attach click handlers to plain
        // elements styled as clickable. Include them; the nesting filter prunes.
        if (config.useCursorPointer) {
            root.querySelectorAll('*').forEach(el => {
                if (seen.has(el) || el === root) return;
                try {
                    if (window.getComputedStyle(el).cursor === 'pointer') consider(el);
                } catch (e) {}
            });
        }

        if (config.nesting === 'innermost') {
            // Keep only leaf-most targets: drop any element that contains another.
            return list.filter(el => !list.some(other => other !== el && el.contains(other)));
        }
        // outermost (default): drop any element contained by another candidate.
        return list.filter(el => !list.some(other => other !== el && other.contains(el)));
    }

    function getFirstNavigableElement(root) {
        root = root || document;
        if (root === document && config.firstElementSelectors && config.firstElementSelectors.length) {
            for (const sel of config.firstElementSelectors) {
                const el = document.querySelector(sel);
                if (el && isVisible(el)) return el;
            }
        }
        const all = getNavigableElements(root);
        return all.length ? all[0] : null;
    }

    function centerOf(rect) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function navigate(direction) {
        if (window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
            window.CouchBrowserVirtualKeyboard.navigate(direction);
            return;
        }
        checkScopeChange();
        const root = getScope();
        const elements = getNavigableElements(root);
        if (elements.length === 0) {
            console.log('Couch Browser: No navigable elements found');
            return;
        }

        let current = currentElement;
        let lastKnownCenter = null;
        if (current && document.contains(current)) {
            lastKnownCenter = centerOf(current.getBoundingClientRect());
        }

        const validCurrent = current
            && document.contains(current)
            && isVisible(current)
            && root.contains(current)
            && current !== root;

        if (!validCurrent) {
            // Either nothing selected yet, or the scope changed (overlay or drill)
            // or the previous selection is now invisible/obscured.
            if (!lastKnownCenter && root === document && elements.indexOf(document.activeElement) !== -1) {
                current = document.activeElement;
            } else if (lastKnownCenter) {
                // If we have a last known position, we proceed with the navigation logic 
                // using that position as the starting point.
                current = { getBoundingClientRect: () => ({ 
                    left: lastKnownCenter.x, top: lastKnownCenter.y, 
                    width: 0, height: 0, right: lastKnownCenter.x, bottom: lastKnownCenter.y 
                }) };
            } else {
                const first = getFirstNavigableElement(root) || elements[0];
                setCurrent(first);
                return;
            }
        }

        const cc = centerOf(current.getBoundingClientRect());

        let best = null, bestScore = Infinity;          // strict: aligned in a cone
        let relaxed = null, relaxedScore = Infinity;     // fallback: anywhere in direction

        for (const el of elements) {
            if (el === current) continue;

            const ec = centerOf(el.getBoundingClientRect());
            const dx = ec.x - cc.x;
            const dy = ec.y - cc.y;

            let primary, cross, inDirection;
            switch (direction) {
                case 'ArrowRight': inDirection = dx > 2;  primary = dx;  cross = Math.abs(dy); break;
                case 'ArrowLeft':  inDirection = dx < -2; primary = -dx; cross = Math.abs(dy); break;
                case 'ArrowDown':  inDirection = dy > 2;  primary = dy;  cross = Math.abs(dx); break;
                case 'ArrowUp':    inDirection = dy < -2; primary = -dy; cross = Math.abs(dx); break;
                default: inDirection = false;
            }
            if (!inDirection) continue;

            const rScore = primary + cross * 2;
            if (rScore < relaxedScore) { relaxedScore = rScore; relaxed = el; }

            if (cross <= primary * 1.5) {
                const score = primary + cross * 3;
                if (score < bestScore) { bestScore = score; best = el; }
            }
        }

        const target = best || relaxed;
        if (target) {
            setCurrent(target);
        } else {
            console.log('Couch Browser: No suitable next element found in direction', direction);
        }
    }

    function drillIn() {
        if (!currentElement || !document.contains(currentElement)) return;
        const inner = getNavigableElements(currentElement);
        if (inner.length === 0) {
            console.log('Couch Browser: Nothing to drill into');
            return;
        }
        drillScope = currentElement;
        setCurrent(getFirstNavigableElement(currentElement) || inner[0]);
    }

    function dispatchEscape(target) {
        if (!target) target = document;
        const targets = target === document ? [document] : [target, document];
        targets.forEach(t => {
            ['keydown', 'keyup'].forEach(type => {
                t.dispatchEvent(new KeyboardEvent(type, {
                    key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
                    bubbles: true, cancelable: true, composed: true
                }));
            });
        });
    }

    // B / Escape: a contextual cancel/back. This never navigates browser history
    // (that is the LB shoulder button). It unwinds the current interaction:
    // drill-out, then close an open popup/overlay, then dispatch Escape.
    function back() {
        if (window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
            window.CouchBrowserVirtualKeyboard.close();
            updateSelectionIndicator(currentElement);
            return;
        }
        const overlay = getActiveOverlay();

        // 1. Drilled in (and no overlay above) -> drill back out.
        if (drillScope && !overlay) {
            const former = drillScope;
            drillScope = null;
            if (former && document.contains(former)) {
                setCurrent(former);
            } else {
                setCurrent(getFirstNavigableElement(document));
            }
            checkScopeChange();
            return;
        }

        // 2. Overlay/popup open -> close it. Prefer its close button; otherwise
        //    dispatch Escape into the overlay so popups that close on Escape do.
        if (overlay) {
            const close = overlay.querySelector(config.closeSelectors);
            if (close) { close.click(); }
            else { dispatchEscape(overlay); }
            setTimeout(() => checkScopeChange(), 100);
            return;
        }

        // 3. No overlay/drill -> dispatch a real Escape so the site can react
        //    (close menus, dismiss inline UI, etc.). gamepad.js dispatches no
        //    synthetic keys, so core is the single source.
        dispatchEscape((currentElement && document.contains(currentElement)) ? currentElement : document);
    }

    function setCurrent(el) {
        currentElement = el;

        if (!el) {
            updateSelectionIndicator(null);
            return;
        }

        suppressFocusSync = true;
        try { el.focus({ preventScroll: true }); } catch (e) { /* element may not be focusable */ }
        suppressFocusSync = false;

        try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } catch (e) {}

        if (typeof config.onSelect === 'function') {
            try { config.onSelect(el); } catch (e) {}
        }

        updateSelectionIndicator(el);
    }

    function ensureIndicator() {
        if (!selectionIndicator) {
            selectionIndicator = document.getElementById('couch-browser-selection-indicator');
        }
        if (!selectionIndicator) {
            selectionIndicator = document.createElement('div');
            selectionIndicator.id = 'couch-browser-selection-indicator';
            selectionIndicator.style.position = 'absolute';
            selectionIndicator.style.pointerEvents = 'none';
            selectionIndicator.style.boxSizing = 'border-box';
            selectionIndicator.style.zIndex = '999998';
            selectionIndicator.style.transition = 'all 0.1s ease-out';
            selectionIndicator.style.borderRadius = '4px';
            document.body.appendChild(selectionIndicator);
        }
        // Apply theme each time (config may register after the indicator exists).
        selectionIndicator.style.border = '3px solid ' + config.indicatorColor;
        selectionIndicator.style.boxShadow = '0 0 12px ' + config.indicatorColor;
        return selectionIndicator;
    }

    function getContainer(el) {
        if (typeof config.getContainer === 'function') {
            try {
                const c = config.getContainer(el);
                if (c) return c;
            } catch (e) {}
        }
        return el;
    }

    function updateSelectionIndicator(el) {
        if (window.self !== window.top) return;
        el = el || currentElement || document.activeElement;

        if (!isGamepadConnected || !el || el === document.body || el === document.documentElement || !document.contains(el)) {
            if (selectionIndicator) selectionIndicator.style.display = 'none';
            return;
        }

        const target = getContainer(el) || el;
        ensureIndicator();

        const rect = getVisualBounds(target);
        if (!rect) {
            selectionIndicator.style.display = 'none';
            return;
        }
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;

        selectionIndicator.style.display = 'block';
        selectionIndicator.style.top = (rect.top + scrollY) + 'px';
        selectionIndicator.style.left = (rect.left + scrollX) + 'px';
        selectionIndicator.style.width = rect.width + 'px';
        selectionIndicator.style.height = rect.height + 'px';
    }

    function activateCurrent() {
        const el = currentElement && document.contains(currentElement) ? currentElement : document.activeElement;
        if (el && el !== document.body && el !== document.documentElement) {
            if (window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
                window.CouchBrowserVirtualKeyboard.activate();
                return;
            }
            if (window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isTextTarget(el)) {
                window.CouchBrowserVirtualKeyboard.open(el);
                if (selectionIndicator) selectionIndicator.style.display = 'none';
                return;
            }
            console.log('Couch Browser: Activating', el);
            el.click();
            setTimeout(() => checkScopeChange(), 100);
        }
    }

    function getScrollable(el) {
        let node = el;
        while (node && node !== document.body && node !== document.documentElement) {
            const style = window.getComputedStyle(node);
            const oy = style.overflowY, ox = style.overflowX;
            const canY = (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight;
            const canX = (ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth;
            if (canY || canX) return node;
            node = node.parentElement;
        }
        return null;
    }

    function handleScroll(dx, dy) {
        if (window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) return;
        const scrollable = getScrollable(currentElement);
        if (scrollable) {
            // Explicitly request instant scrolling. Both scrollBy() and
            // scrollTop assignment can still be affected by a page's
            // scroll-behavior:smooth (as on github.com/tentone/syncinput).
            scrollable.scrollTo({
                left: scrollable.scrollLeft + dx,
                top: scrollable.scrollTop + dy,
                behavior: 'instant'
            });
        } else {
            // Use the scrolling element so this also works consistently when
            // the document has globally enabled smooth scrolling.
            const root = document.scrollingElement || document.documentElement;
            root.scrollTo({
                left: root.scrollLeft + dx,
                top: root.scrollTop + dy,
                behavior: 'instant'
            });
        }
        updateSelectionIndicator(currentElement);
    }

    // ----- Browser history navigation (LB / RB) ---------------------------

    function navigateHistory(delta) {
        if (!config.historyNavigation) return;
        // Only the top frame should drive browser history.
        if (window.self !== window.top) return;
        try {
            if (delta < 0) window.history.back();
            else window.history.forward();
        } catch (e) {}
    }

    // ----- Virtual mouse cursor (right trigger held) ----------------------

    function ensureCursor() {
        if (window.self !== window.top) return null;
        if (!cursorEl) {
            cursorEl = document.getElementById('couch-browser-cursor');
        }
        if (!cursorEl) {
            cursorEl = document.createElement('div');
            cursorEl.id = 'couch-browser-cursor';
            cursorEl.style.position = 'fixed';
            cursorEl.style.width = '18px';
            cursorEl.style.height = '18px';
            cursorEl.style.marginLeft = '-9px';
            cursorEl.style.marginTop = '-9px';
            cursorEl.style.borderRadius = '50%';
            cursorEl.style.boxSizing = 'border-box';
            cursorEl.style.zIndex = '2147483647';
            // pointer-events:none is essential so elementFromPoint hits the page,
            // not the cursor itself.
            cursorEl.style.pointerEvents = 'none';
            cursorEl.style.display = 'none';
            (document.body || document.documentElement).appendChild(cursorEl);
        }
        cursorEl.style.border = '2px solid ' + config.indicatorColor;
        cursorEl.style.background = 'rgba(255, 255, 255, 0.35)';
        cursorEl.style.boxShadow = '0 0 8px ' + config.indicatorColor;
        return cursorEl;
    }

    function positionCursor() {
        if (!cursorEl) return;
        cursorEl.style.left = cursorX + 'px';
        cursorEl.style.top = cursorY + 'px';
    }

    function startCursor() {
        if (!config.cursorMode) return;
        cursorActive = true;
        // Start from the center of the current selection if available, else the
        // viewport center.
        const keyboardCursor = window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.cursorTarget();
        if (keyboardCursor) {
            cursorX = keyboardCursor.x;
            cursorY = keyboardCursor.y;
        } else if (currentElement && document.contains(currentElement)) {
            const r = currentElement.getBoundingClientRect();
            cursorX = r.left + r.width / 2;
            cursorY = r.top + r.height / 2;
        } else if (!cursorX && !cursorY) {
            cursorX = window.innerWidth / 2;
            cursorY = window.innerHeight / 2;
        }
        ensureCursor();
        positionCursor();
        if (cursorEl) cursorEl.style.display = 'block';
        if (window.CouchBrowserVirtualKeyboard) {
            window.CouchBrowserVirtualKeyboard.animateSelected();
        }
        // Hide the selection indicator so the UI is unambiguous in cursor mode.
        if (selectionIndicator) selectionIndicator.style.display = 'none';
    }

    function stopCursor() {
        cursorActive = false;
        if (cursorEl) cursorEl.style.display = 'none';
        updateSelectionIndicator(currentElement);
    }

    function moveCursor(dx, dy) {
        if (!cursorActive) return;
        cursorX = Math.max(0, Math.min(window.innerWidth, cursorX + dx));
        cursorY = Math.max(0, Math.min(window.innerHeight, cursorY + dy));
        positionCursor();
        if (window.CouchBrowserVirtualKeyboard) {
            window.CouchBrowserVirtualKeyboard.cursorMove(cursorX, cursorY);
        }
    }

    function cursorClick() {
        if (!cursorActive) return;
        if (window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.cursorClick(cursorX, cursorY)) return;
        const target = document.elementFromPoint(cursorX, cursorY);
        if (!target || target === document.body || target === document.documentElement) return;
        const opts = {
            bubbles: true, cancelable: true, composed: true, view: window,
            clientX: cursorX, clientY: cursorY, button: 0
        };
        try { target.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        try { target.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
        setTimeout(() => checkScopeChange(), 100);
    }

    // ----- Hide the real OS mouse cursor while the gamepad is in use ------
    // We cannot move the OS cursor from JS, but we can hide it so it no longer
    // shows or visually competes with gamepad selection. A genuine mouse move
    // restores it. (Note: a static pointer keeps any existing :hover state; we
    // only suppress the visible cursor, which is what causes the distraction.)
    let gamepadActive = false;
    let cursorStyleEl = null;

    function ensureCursorStyle() {
        if (cursorStyleEl) return;
        cursorStyleEl = document.getElementById('couch-browser-hide-cursor-style');
        if (cursorStyleEl) return;
        cursorStyleEl = document.createElement('style');
        cursorStyleEl.id = 'couch-browser-hide-cursor-style';
        cursorStyleEl.textContent =
            'html.couch-browser-gamepad-active, html.couch-browser-gamepad-active * { cursor: none !important; }';
        (document.head || document.documentElement).appendChild(cursorStyleEl);
    }

    function setGamepadActive(active) {
        if (active === gamepadActive) return;
        gamepadActive = active;
        const root = document.documentElement;
        if (!root) return;
        if (active) {
            ensureCursorStyle();
            root.classList.add('couch-browser-gamepad-active');
        } else {
            root.classList.remove('couch-browser-gamepad-active');
        }
    }

    // ----- Event wiring ---------------------------------------------------

    // Real keyboard navigation, only when the site config opts in (so we never
    // hijack arrow keys on arbitrary pages). Genuine key presses only.
    document.addEventListener('keydown', (e) => {
        if (!config.captureKeyboard) return;
        if (!e.isTrusted) return;
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
            navigate(e.key);
            e.preventDefault();
        }
    }, true);

    // Keep our selection in sync when focus changes by other means (mouse, Tab).
    document.addEventListener('focusin', (e) => {
        if (suppressFocusSync) return;
        const el = e.target;
        if (!el || el === document.body || el === document.documentElement) return;
        const overlay = getActiveOverlay();
        if (overlay && !overlay.contains(el)) return;
        currentElement = el;
        updateSelectionIndicator(el);
    }, true);

    window.addEventListener('scroll', () => updateSelectionIndicator(currentElement), true);
    window.addEventListener('resize', () => updateSelectionIndicator(currentElement), true);

    // A genuine mouse move restores the real cursor (the user took over the mouse).
    document.addEventListener('mousemove', (e) => {
        if (e.isTrusted) setGamepadActive(false);
    }, true);

    // Gamepad input forwarded from the polling script (gamepad.js).
    window.addEventListener('message', (event) => {
        if (!event.data || event.data.source !== 'couch-browser-extension') return;

        // Any input from the gamepad hides the real OS cursor so it stops
        // triggering hover effects and visually competing with selection.
        if (event.data.type !== 'COUCH_BROWSER_CONNECTION') {
            setGamepadActive(true);
        }

        if (event.data.type === 'COUCH_BROWSER_CONNECTION') {
            const wasConnected = isGamepadConnected;
            isGamepadConnected = !!event.data.connected;
            if (isGamepadConnected && !wasConnected) {
                if (config.autoSelect && !currentElement) {
                    const first = getFirstNavigableElement();
                    if (first) setCurrent(first);
                }
                updateSelectionIndicator();
            } else if (!isGamepadConnected && wasConnected) {
                updateSelectionIndicator();
            }
        } else if (event.data.type === 'COUCH_BROWSER_KEY') {
            const key = event.data.key;
            if (key === 'ShiftOn' || key === 'ShiftOff') {
                if (window.CouchBrowserVirtualKeyboard) window.CouchBrowserVirtualKeyboard.setShift(key === 'ShiftOn');
            } else if (key === 'KeyboardBackspace' && window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
                window.CouchBrowserVirtualKeyboard.backspace();
            } else if (key.indexOf('InputArrow') === 0 && window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
                window.CouchBrowserVirtualKeyboard.moveCaret(key.substring('Input'.length));
            } else if (key === 'KeyboardActivate' && window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
                window.CouchBrowserVirtualKeyboard.activate();
            } else if (key === 'Enter' && window.CouchBrowserVirtualKeyboard && window.CouchBrowserVirtualKeyboard.isOpen()) {
                window.CouchBrowserVirtualKeyboard.enter();
            } else if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(key)) {
                navigate(key);
            } else if (key === 'Enter') {
                activateCurrent();
            } else if (key === 'Escape') {
                back();
            } else if (key === 'PadX') {
                drillIn();
            } else if (key === 'NavBack') {
                navigateHistory(-1);
            } else if (key === 'NavForward') {
                navigateHistory(1);
            } else if (key === 'CursorOn') {
                startCursor();
            } else if (key === 'CursorOff') {
                stopCursor();
            } else if (key === 'MouseClick') {
                cursorClick();
            }
        } else if (event.data.type === 'COUCH_BROWSER_SCROLL') {
            handleScroll(event.data.dx || 0, event.data.dy || 0);
        } else if (event.data.type === 'COUCH_BROWSER_CURSOR') {
            moveCursor(event.data.dx || 0, event.data.dy || 0);
        }
    });

    function init() {
        lastScope = getScope();
        if (isGamepadConnected && config.autoSelect && !currentElement) {
            const first = getFirstNavigableElement();
            if (first) setCurrent(first);
        }
        initialized = true;

        // Watch for overlays appearing/disappearing to update scope and selection.
        const observer = new MutationObserver(() => checkScopeChange());
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open'] });
    }

    function start() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    // ----- Public registration API ---------------------------------------

    window.CouchBrowser = window.CouchBrowser || {};
    window.CouchBrowser.registerSite = function(cfg) {
        config = Object.assign({}, DEFAULT_CONFIG, cfg || {});
        console.log('Couch Browser: Registered site config "' + config.name + '"');
        // Config may arrive before or after DOM ready. Re-run init either way.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
        // Re-theme an already-created indicator.
        if (selectionIndicator) ensureIndicator();
    };

    window.CouchBrowserSiteLogic = {
        update: () => updateSelectionIndicator(currentElement),
        navigate: navigate,
        get current() { return currentElement; },
        get cursorActive() { return cursorActive; },
        get cursorPosition() { return { x: cursorX, y: cursorY }; }
    };

    // Start with default config; a site file may override via registerSite.
    start();
})();
