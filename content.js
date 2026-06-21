(function() {
    console.log('Couch Browser: Content script loaded in ' + (window.self === window.top ? 'top frame' : 'iframe'));

    function injectScript(path) {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(path);
        // Dynamically-created scripts default to async; force ordered execution
        // so core.js defines registerSite before the site config runs.
        script.async = false;
        (document.head || document.documentElement).appendChild(script);
    }

    // Dynamically load site-specific logic (also Main World).
    const domain = window.location.hostname.replace(/^www\./, '');

    async function init() {
        // Gamepad polling must run in the Main World: Chrome does not expose
        // connected gamepads to content-script isolated worlds.
        injectScript('gamepad.js');

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
            result = await chrome.storage.sync.get(key);
        } catch (e) {
            console.error('Couch Browser: Failed to read storage', e);
        }

        if (result && result[key]) {
            console.log(`Couch Browser: Extension selection is disabled for ${domain}`);
            return;
        }

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
            if (event.source !== window) return;
            const data = event.data;
            if (data && data.source === 'couch-browser-extension' && (data.type === 'COUCH_BROWSER_TAB' || data.type === 'COUCH_BROWSER_TAB_CLOSE')) {
                console.log('Couch Browser: Relaying message to background:', data.type);
                try {
                    chrome.runtime.sendMessage(data);
                } catch (e) {
                    console.error('Couch Browser: Failed to relay message', e);
                }
            }
        });
    }
    
    init();
})();
