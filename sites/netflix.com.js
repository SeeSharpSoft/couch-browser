(function() {
    // Netflix site configuration. All logic lives in core.js; this file only
    // supplies selectors and behaviour tweaks via window.CouchBrowser.registerSite.
    console.log('Couch Browser: Netflix config loaded');

    if (!window.CouchBrowser || typeof window.CouchBrowser.registerSite !== 'function') {
        console.warn('Couch Browser: core engine not loaded before site config');
        return;
    }

    // Prefer highlighting the nearest semantic container when selection lands on
    // a nested child (title cards, billboard CTAs, header nav).
    function getContainer(el) {
        if (!el) return null;
        return el.closest('.title-card-container')
            || el.closest('.billboard-links')
            || el.closest('.navigation-tab')
            || el.closest('.nav-element')
            || el.closest('.navigation-menu')
            || el;
    }

    window.CouchBrowser.registerSite({
        name: 'netflix.com',
        indicatorColor: '#E50914',
        // Netflix manages its own focus; preserve the original innermost-leaf
        // navigation behaviour.
        nesting: 'innermost',
        useCursorPointer: false,
        extraSelectors: [
            '.navigation-tab a',
            'a.menu-trigger[data-uia="main-header-menu-trigger"]',
            'button.searchTab[data-uia="search-box-launcher"]',
            'button.notifications-menu[data-uia="notifications-menu-button"]',
            '.account-dropdown-button a[role="button"]',
            '[data-uia="play-button"]',
            '[data-uia="billboard-more-info"]',
            '.title-card-container a.slider-refocus',
            '.title-card a',
            '.slider-refocus',
            '.handleNext[role="button"]',
            '.handlePrev[role="button"]',
            '.member-footer-link'
        ],
        overlaySelectors: [
            '.previewModal--container',
            '[data-uia="preview-modal"]',
            '[data-uia^="preview-modal"]',
            '.detail-modal',
            '[data-uia="modal"]',
            '[role="dialog"]',
            '[aria-modal="true"]'
        ],
        closeSelectors: '[data-uia*="close" i], .previewModal-close, button[aria-label*="close" i], [aria-label*="Close" i]',
        firstElementSelectors: [
            '.navigation-tab a',
            '[data-uia="play-button"]',
            '.title-card a, .slider-refocus'
        ],
        onSelect: function(el) {
            if (el.matches('.handleNext[role="button"], .handlePrev[role="button"]')) {
                console.log('Couch Browser: Auto-activating Netflix slider button');
                el.click();
            }
        },
        getContainer: getContainer
    });
})();
