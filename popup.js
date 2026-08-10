const toggle = document.getElementById('enable-toggle');
const domainText = document.getElementById('domain-name');
const cursorSpeed = document.getElementById('cursor-speed');
const scrollSpeed = document.getElementById('scroll-speed');
const cursorSpeedValue = document.getElementById('cursor-speed-value');
const scrollSpeedValue = document.getElementById('scroll-speed-value');
const extensionVersion = document.getElementById('extension-version');
let currentDomain = '';

const DEFAULT_CURSOR_SPEED = 25;
const DEFAULT_SCROLL_SPEED = 1500;

function updateSpeedLabels() {
    cursorSpeedValue.textContent = `${cursorSpeed.value} px/frame`;
    scrollSpeedValue.textContent = `${scrollSpeed.value} px/s`;
}

function updateStatus() {
    const gamepads = navigator.getGamepads();
    let connected = false;
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
            connected = true;
            break;
        }
    }

    const container = document.getElementById('status-container');
    const text = document.getElementById('status-text');

    if (connected) {
        container.className = 'status active';
        text.textContent = 'Gamepad: Connected';
    } else {
        container.className = 'status inactive';
        text.textContent = 'Gamepad: Disconnected';
    }
}

async function init() {
    extensionVersion.textContent = chrome.runtime.getManifest().version;
    let currentTabId = null;

    // Get current tab domain
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
        currentTabId = tab.id;
        try {
            const url = new URL(tab.url);
            if (url.protocol.startsWith('http')) {
                currentDomain = url.hostname.replace(/^www\./, '');
                domainText.textContent = currentDomain;

                // Load setting
                const key = `disabled_${currentDomain}`;
                const result = await chrome.storage.sync.get(key);
                toggle.checked = !result[key];
            } else {
                domainText.textContent = 'Not available for this page';
                toggle.disabled = true;
            }
        } catch (e) {
            console.error(e);
        }
    }

    toggle.addEventListener('change', async () => {
        if (!currentDomain) return;
        const key = `disabled_${currentDomain}`;
        if (toggle.checked) {
            await chrome.storage.sync.remove(key);
        } else {
            await chrome.storage.sync.set({ [key]: true });
        }
        // Reload tab to apply changes
        if (currentTabId) {
            chrome.tabs.reload(currentTabId);
        } else {
            chrome.tabs.reload();
        }
    });

    const settings = await chrome.storage.sync.get(['cursorSpeed', 'scrollSpeed']);
    cursorSpeed.value = Number.isFinite(settings.cursorSpeed) ? settings.cursorSpeed : DEFAULT_CURSOR_SPEED;
    scrollSpeed.value = Number.isFinite(settings.scrollSpeed) ? settings.scrollSpeed : DEFAULT_SCROLL_SPEED;
    updateSpeedLabels();
    cursorSpeed.addEventListener('input', () => {
        updateSpeedLabels();
        const value = Number(cursorSpeed.value);
        chrome.storage.sync.set({ cursorSpeed: value });
        sendSettingsToActiveTab({ cursorSpeed: value });
    });
    scrollSpeed.addEventListener('input', () => {
        updateSpeedLabels();
        const value = Number(scrollSpeed.value);
        chrome.storage.sync.set({ scrollSpeed: value });
        sendSettingsToActiveTab({ scrollSpeed: value });
    });

    function sendSettingsToActiveTab(settings) {
        if (!currentTabId) return;
        chrome.tabs.sendMessage(currentTabId, {
            type: 'COUCH_BROWSER_SETTINGS',
            ...settings
        }, () => {
            // Ignore tabs without a content script (chrome:// pages, etc.).
            void chrome.runtime.lastError;
        });
    }

    // Update status every 500ms
    setInterval(updateStatus, 500);
    updateStatus();
}

init();
