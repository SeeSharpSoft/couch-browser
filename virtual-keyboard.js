(function () {
    // The virtual keyboard owns its DOM and editing state. The navigation engine
    // only forwards controller intent to this small public interface.
    if (window.CouchBrowserVirtualKeyboard) return;

    const rows = [
        [['1', '!'], ['2', '@'], ['3', '#'], ['4', '$'], ['5', '%'], ['6', '^'], ['7', '&'], ['8', '*'], ['9', '('], ['0', ')'], ['-', '_'], ['=', '+'], { special: 'Backspace', label: '⌫  Y' }],
        [['q', 'Q'], ['w', 'W'], ['e', 'E'], ['r', 'R'], ['t', 'T'], ['y', 'Y'], ['u', 'U'], ['i', 'I'], ['o', 'O'], ['p', 'P'], ['[', '{'], [']', '}'], ['\\', '|']],
        [['a', 'A'], ['s', 'S'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'H'], ['j', 'J'], ['k', 'K'], ['l', 'L'], [';', ':'], ["'", '"'], { special: 'Enter', label: 'Enter  X' }],
        [{ special: 'Shift', label: 'Shift  LT' }, ['z', 'Z'], ['x', 'X'], ['c', 'C'], ['v', 'V'], ['b', 'B'], ['n', 'N'], ['m', 'M'], [',', '<'], ['.', '>'], ['/', '?']],
        [{ special: 'Space', label: 'Space' }]
    ];

    let overlay = null;
    let target = null;
    let keyElements = [];
    let selected = 0;
    let shifted = false;

    function isTextTarget(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.isContentEditable) return true;
        if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
        return el.tagName === 'INPUT' && !el.disabled && !el.readOnly &&
            ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes((el.type || 'text').toLowerCase());
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'couch-browser-virtual-keyboard';
        overlay.setAttribute('aria-label', 'Virtual keyboard');
        overlay.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;display:none;width:min(94vw,920px);padding:14px;background:rgba(18,18,22,.97);border:2px solid #4CAF50;border-radius:12px;box-shadow:0 8px 30px #000;box-sizing:border-box;font-family:Arial,sans-serif;user-select:none;';
        const closeHint = document.createElement('div');
        closeHint.setAttribute('aria-label', 'Press B to close the virtual keyboard');
        closeHint.style.cssText = 'position:absolute;top:8px;right:12px;display:flex;align-items:center;gap:5px;color:#ddd;font-size:12px;font-weight:bold;';
        closeHint.append('Close');
        closeHint.append(createButtonBadge('B', 'b'));
        overlay.appendChild(closeHint);
        rows.forEach((row, rowIndex) => {
            const rowEl = document.createElement('div');
            rowEl.style.cssText = 'display:flex;justify-content:center;gap:5px;margin:5px 0;';
            row.forEach((definition, colIndex) => {
                const key = document.createElement('button');
                key.type = 'button';
                key.className = 'cbvk-key';
                key.dataset.row = rowIndex;
                key.dataset.col = colIndex;
                key._definition = definition;
                key.style.cssText = 'height:43px;min-width:42px;padding:0 9px;border:1px solid #666;border-radius:5px;background:#303038;color:#fff;font-size:18px;font-weight:bold;cursor:none;transition:transform .08s ease,filter .08s ease;';
                if (definition.special === 'Space') key.style.flex = '0 1 410px';
                if (definition.special === 'Backspace' || definition.special === 'Enter') key.style.minWidth = '105px';
                key.addEventListener('click', () => press(key));
                rowEl.appendChild(key);
                keyElements.push(key);
            });
            overlay.appendChild(rowEl);
        });
        (document.body || document.documentElement).appendChild(overlay);
        refreshLabels();
        return overlay;
    }

    function refreshLabels() {
        keyElements.forEach((key) => {
            const d = key._definition;
            key.textContent = '';
            if (d.special === 'Backspace') {
                key.append('⌫ ');
                key.append(createButtonBadge('Y', 'y'));
            } else if (d.special === 'Enter') {
                key.append('Enter ');
                key.append(createButtonBadge('X', 'x'));
            } else if (d.special === 'Shift') {
                key.append('Shift ');
                key.append(createButtonBadge('LT', 'lt'));
            } else {
                key.textContent = d.special ? d.label : (shifted ? d[1] : d[0]);
            }
            key.setAttribute('aria-label', d.special || (shifted ? d[1] : d[0]));
            key.style.background = keyElements[selected] === key ? '#4CAF50' : '#303038';
            key.style.color = keyElements[selected] === key ? '#111' : '#fff';
        });
    }

    function createButtonBadge(label, type) {
        const badge = document.createElement('span');
        badge.textContent = label;
        badge.className = 'cbvk-gamepad-badge cbvk-badge-' + (type || label.toLowerCase());
        badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;box-sizing:border-box;font-family:Arial,sans-serif;font-size:12px;font-weight:900;line-height:1;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.55);';
        if (type === 'lt') {
            // A compact trigger-like badge: broad at the top with softened
            // lower corners, visually distinct from the face buttons.
            badge.style.width = '31px';
            badge.style.height = '22px';
            badge.style.marginLeft = '2px';
            badge.style.borderRadius = '7px 7px 11px 11px';
            badge.style.background = 'linear-gradient(#777, #333)';
            badge.style.border = '2px solid #aaa';
        } else {
            badge.style.width = '22px';
            badge.style.height = '22px';
            badge.style.borderRadius = '50%';
            badge.style.marginLeft = '3px';
            badge.style.background = type === 'x' ? '#2376d8' : type === 'b' ? '#d73535' : '#e2bd22';
            if (type === 'y') badge.style.color = '#151515';
            badge.style.border = '1px solid rgba(255,255,255,.65)';
        }
        return badge;
    }

    function focusSelected() {
        const key = keyElements[selected];
        if (!key) return;
        key.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        refreshLabels();
    }

    function edit(value, replaceSelection) {
        if (!target) return;
        if (target.isContentEditable) {
            document.execCommand('insertText', false, value);
            return;
        }
        const start = target.selectionStart == null ? target.value.length : target.selectionStart;
        const end = target.selectionEnd == null ? start : target.selectionEnd;
        const next = target.value.slice(0, start) + value + target.value.slice(end);
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value');
        if (setter && setter.set) setter.set.call(target, next); else target.value = next;
        const caret = replaceSelection ? start + value.length : next.length;
        try { target.setSelectionRange(caret, caret); } catch (e) {}
        target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }

    function animateKey(key) {
        if (!key) return;
        key.style.transform = 'scale(.93)';
        key.style.filter = 'brightness(1.45)';
        clearTimeout(key._pressAnimationTimer);
        key._pressAnimationTimer = setTimeout(() => {
            key.style.transform = '';
            key.style.filter = '';
        }, 110);
    }

    function press(key) {
        if (!key) return;
        animateKey(key);
        const d = key._definition;
        if (d.special === 'Enter') {
            setTimeout(close, 110);
            return;
        }
        if (d.special === 'Shift') { shifted = !shifted; refreshLabels(); return; }
        if (d.special === 'Backspace') { backspace(); return; }
        edit(d.special === 'Space' ? ' ' : (shifted ? d[1] : d[0]), true);
    }

    function backspace() {
        if (!target) return;
        animateKey(keyElements.find((key) => key._definition.special === 'Backspace'));
        if (target.isContentEditable) {
            document.execCommand('delete', false);
            return;
        }
        const start = target.selectionStart == null ? target.value.length : target.selectionStart;
        const end = target.selectionEnd == null ? start : target.selectionEnd;
        if (start === 0 && end === 0) return;
        if (start === end) {
            try { target.setSelectionRange(start - 1, start); } catch (e) {}
        }
        edit('', true);
    }

    function moveCaret(direction) {
        if (!target || target.isContentEditable || target.selectionStart == null) return;
        const value = target.value;
        let position = target.selectionStart;
        const end = target.selectionEnd;
        if (direction === 'ArrowLeft') position = Math.max(0, position - 1);
        else if (direction === 'ArrowRight') position = Math.min(value.length, end + 1);
        else if (direction === 'ArrowUp' || direction === 'ArrowDown') {
            const lineStart = value.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
            const column = position - lineStart;
            if (direction === 'ArrowUp') {
                if (lineStart === 0) return;
                const previousEnd = lineStart - 1;
                const previousStart = value.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1;
                position = previousStart + Math.min(column, previousEnd - previousStart);
            } else {
                const lineEnd = value.indexOf('\n', position);
                if (lineEnd < 0) return;
                const nextStart = lineEnd + 1;
                const nextEnd = value.indexOf('\n', nextStart);
                position = nextStart + Math.min(column, (nextEnd < 0 ? value.length : nextEnd) - nextStart);
            }
        }
        try { target.setSelectionRange(position, position); } catch (e) {}
    }

    function updateCursorSelection(x, y) {
        if (!target || !overlay) return;
        const hit = document.elementFromPoint(x, y);
        const key = hit && hit.closest ? hit.closest('.cbvk-key') : null;
        if (!key || !overlay.contains(key)) return;
        const index = keyElements.indexOf(key);
        if (index >= 0 && index !== selected) {
            selected = index;
            refreshLabels();
        }
    }

    function open(el) {
        if (!isTextTarget(el)) return false;
        target = el;
        ensureOverlay().style.display = 'block';
        selected = 0;
        shifted = false;
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        focusSelected();
        return true;
    }

    function close() {
        if (!target) return;
        const oldTarget = target;
        target = null;
        if (overlay) overlay.style.display = 'none';
        try { oldTarget.focus({ preventScroll: true }); } catch (e) {}
    }

    function navigate(direction) {
        if (!target || !keyElements.length) return false;
        const current = keyElements[selected].getBoundingClientRect();
        const cx = current.left + current.width / 2, cy = current.top + current.height / 2;
        let best = -1, score = Infinity;
        keyElements.forEach((key, i) => {
            if (i === selected) return;
            const r = key.getBoundingClientRect();
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            const primary = direction === 'ArrowLeft' ? cx - x : direction === 'ArrowRight' ? x - cx : direction === 'ArrowUp' ? cy - y : y - cy;
            const cross = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(y - cy) : Math.abs(x - cx);
            // Only consider keys genuinely in the requested direction. The
            // previous >= -1 check admitted every key on the current row
            // (their primary distance is zero), so Down/Up often moved
            // sideways instead of entering the next row.
            if (primary > 1) {
                const value = primary + cross * 2;
                if (value < score) { score = value; best = i; }
            }
        });
        if (best < 0) return true;
        selected = best;
        focusSelected();
        return true;
    }

    window.CouchBrowserVirtualKeyboard = {
        isOpen: () => !!target,
        isTextTarget,
        open,
        close,
        navigate,
        activate: () => { if (target) press(keyElements[selected]); return true; },
        backspace,
        moveCaret,
        cursorMove: updateCursorSelection,
        animateSelected: () => { if (target) animateKey(keyElements[selected]); },
        enter: () => {
            if (target) {
                const enterKey = keyElements.find((key) => key._definition.special === 'Enter');
                animateKey(enterKey);
                setTimeout(close, 110);
            }
            return true;
        },
        setShift: (on) => { if (target) { shifted = !!on; refreshLabels(); } },
        cursorTarget: () => {
            if (!target || !keyElements[selected]) return null;
            const r = keyElements[selected].getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        },
        cursorClick: (x, y) => {
            if (!target) return false;
            const hit = document.elementFromPoint(x, y);
            const key = hit && hit.closest ? hit.closest('.cbvk-key') : null;
            if (!key || !overlay.contains(key)) return true;
            selected = keyElements.indexOf(key);
            press(key);
            return true;
        }
    };
})();
