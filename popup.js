const toggle = document.getElementById('enable-toggle');
const domainText = document.getElementById('domain-name');
let currentDomain = '';

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

    // Update status every 500ms
    setInterval(updateStatus, 500);
    updateStatus();
}

init();
