(function() {
    console.log('Couch Browser: Content script loaded in ' + (window.self === window.top ? 'top frame' : 'iframe'));

    function injectScript(path) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(path);
            // Dynamically-created scripts default to async; force ordered execution
            // so core.js defines registerSite before the site config runs.
            script.async = false;
            script.onload = resolve;
            script.onerror = reject;
            (document.head || document.documentElement).appendChild(script);
        });
    }

    // Dynamically load site-specific logic (also Main World).
    const domain = window.location.hostname.replace(/^www\./, '');

    async function init() {
        // Gamepad polling must run in the Main World: Chrome does not expose
        // connected gamepads to content-script isolated worlds.
        // Wait for gamepad.js to be evaluated before posting settings. Otherwise
        // a fast storage read can beat the external script load on new pages.
        await injectScript('gamepad.js');
        await injectScript('virtual-keyboard.js');

        // Try to enable gamepad access for iframes by adding the allow attribute.
        if (window.self === window.top) {
            const enableGamepadInIframes = () => {
                document.querySelectorAll('iframe:not([allow*="gamepad"])').forEach(iframe => {
                    let allow = iframe.getAttribute('allow') || '';
                    if (!allow.includes('gamepad')) {
                        iframe.setAttribute('allow', (allow ? allow + '; ' : '') + 'gamepad');
                        // Reloading the iframe might be necessary for the policy to take effect, 
                        // but it can be disruptive. For now, we just set the attribute for future loads
                        // or for cases where it works dynamically.
                    }
                });
            };
            enableGamepadInIframes();
            const observer = new MutationObserver(enableGamepadInIframes);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }

        const key = `disabled_${domain}`;
        let result = {};
        try {
            result = await chrome.storage.sync.get([key, 'defaultMode', 'cursorSpeed', 'scrollSpeed']);
        } catch (e) {
            console.error('Couch Browser: Failed to read storage', e);
        }

        if (result && result[key]) {
            console.log(`Couch Browser: Extension selection is disabled for ${domain}`);
            return;
        }

        window.postMessage({
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_DEFAULT_MODE',
            mode: result.defaultMode === 'navigation' ? 'navigation' : 'cursor'
        }, '*');
        postSettings(result);

        console.log(`Couch Browser: Extension selection is enabled for ${domain}`);

        // Central navigation engine (Main World). Must load before any site config.
        injectScript('core.js');

        loadSiteLogic();
    }

    async function checkFileExists(url) {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    async function loadSiteLogic() {
        const scriptPath = `sites/${domain}.js`;
        let pathToLoad = 'sites/default.js';
        const fullScriptPath = chrome.runtime.getURL(scriptPath);
        if (await checkFileExists(fullScriptPath)) {
            pathToLoad = scriptPath;
        }

        console.log(`Couch Browser: Loading site logic from ${pathToLoad}`);

        try {
            injectScript(pathToLoad);
        } catch (e) {
            console.error('Couch Browser: Failed to load site logic', e);
        }
    }

    // Relay tab-switch intents (right trigger + shoulder buttons) from the page's
    // Main World to the background service worker, which owns the chrome.tabs API.
    // Only the top frame relays so iframes don't trigger duplicate switches.
    if (window.self === window.top) {
        window.addEventListener('message', (event) => {
            const data = event.data;
            // gamepad.js runs in the page's Main World while this listener runs
            // in the isolated content-script world. The Window identity can be
            // wrapped differently between those worlds, so authenticate using
            // the message marker instead of event.source.
            if (data && data.source === 'couch-browser-extension' && (data.type === 'COUCH_BROWSER_TAB' || data.type === 'COUCH_BROWSER_TAB_CLOSE' || data.type === 'COUCH_BROWSER_TAB_RELOAD')) {
                console.log('Couch Browser: Relaying message to background:', data.type);
                try {
                    chrome.runtime.sendMessage(data);
                } catch (e) {
                    console.error('Couch Browser: Failed to relay message', e);
                }
            }
            if (data && data.source === 'couch-browser-extension' && data.type === 'COUCH_BROWSER_DEFAULT_MODE_SET') {
                chrome.storage.sync.set({ defaultMode: data.mode === 'cursor' ? 'cursor' : 'navigation' });
            }
            if (data && data.source === 'couch-browser-extension' && data.type === 'COUCH_BROWSER_SETTINGS_REQUEST') {
                chrome.storage.sync.get(['cursorSpeed', 'scrollSpeed']).then(postSettings);
            }
        });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes.defaultMode) {
            window.postMessage({
                source: 'couch-browser-extension',
                type: 'COUCH_BROWSER_DEFAULT_MODE',
                mode: changes.defaultMode.newValue === 'navigation' ? 'navigation' : 'cursor'
            }, '*');
        }
        if (changes.cursorSpeed || changes.scrollSpeed) {
            postSettings({
            cursorSpeed: changes.cursorSpeed && changes.cursorSpeed.newValue,
                scrollSpeed: changes.scrollSpeed && changes.scrollSpeed.newValue
            });
        }
    });

    // The popup also sends live updates directly to the active tab. This keeps
    // slider changes responsive even when storage synchronization is delayed.
    chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== 'COUCH_BROWSER_SETTINGS') return;
        postSettings(message);
    });

    function postSettings(settings) {
        const message = {
            source: 'couch-browser-extension',
            type: 'COUCH_BROWSER_SETTINGS'
        };
        if (Number.isFinite(settings.cursorSpeed) && settings.cursorSpeed > 0) message.cursorSpeed = Math.min(settings.cursorSpeed, 50);
        if (Number.isFinite(settings.scrollSpeed) && settings.scrollSpeed > 0) message.scrollSpeed = Math.min(settings.scrollSpeed, 3000);
        window.postMessage(message, '*');
    }
    
    init();
})();
