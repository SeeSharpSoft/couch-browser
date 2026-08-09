(function() {
    // Prime Video site configuration.
    console.log('Couch Browser: Prime Video config loaded');

    if (!window.CouchBrowser || typeof window.CouchBrowser.registerSite !== 'function') {
        console.warn('Couch Browser: core engine not loaded before site config');
        return;
    }

    // Prefer highlighting the nearest semantic container for title cards and rows.
    function getContainer(el) {
        if (!el) return null;
        return el.closest('.tst-title-card')
            || el.closest('.tst-video-card')
            || el.closest('.tst-packshot')
            || el.closest('.tst-hover-container')
            || el.closest('.av-titletreatment-container')
            || el.closest('.tst-navigation-item')
            || el;
    }

    window.CouchBrowser.registerSite({
        name: 'primevideo.com',
        indicatorColor: '#00A8E1', // Prime Video Blue
        // Prime Video has many nested elements; use innermost to get precise selection
        // but getContainer will help highlight the whole card.
        nesting: 'innermost',
        useCursorPointer: true,
        captureKeyboard: true,
        extraSelectors: [
            // Top/Side Navigation
            '.tst-navigation-item a',
            '.tst-nav-menu-item',
            'a[data-automation-id="navigation-item"]',
            // Title Cards / Movie Links
            '.tst-title-card a',
            '.tst-video-card a',
            '.tst-packshot a',
            'a[data-automation-id="title-card-link"]',
            '.tst-hover-container a',
            // Player Controls (if visible)
            '.tst-play-button',
            '.tst-details-button',
            // Row Navigation Buttons (Sliders)
            '.tst-pagination-next',
            '.tst-pagination-prev',
            'button[aria-label*="next" i]',
            'button[aria-label*="previous" i]',
            '.tst-pagination-next[role="button"]',
            '.tst-pagination-prev[role="button"]',
            // Profile / Account
            '.tst-profile-selector-item',
            '.tst-account-menu-button'
        ],
        excludeSelectors: [
            '.tst-pagination-dot',
            '.tst-hidden'
        ],
        overlaySelectors: [
            '.tst-modal-container',
            '[role="dialog"]',
            '[aria-modal="true"]',
            '.av-dialog-container',
            '.tst-details-modal'
        ],
        closeSelectors: [
            '.tst-close-button',
            '[aria-label*="close" i]',
            '.av-dialog-close',
            '.tst-modal-close'
        ],
        firstElementSelectors: [
            '.tst-navigation-item a',
            '.tst-title-card a',
            '.tst-play-button'
        ],
        onSelect: function(el) {
            // Auto-activate slider buttons when they are selected (similar to Netflix)
            if (el.matches('.tst-pagination-next, .tst-pagination-prev, button[aria-label*="next" i], button[aria-label*="previous" i]')) {
                console.log('Couch Browser: Auto-activating Prime Video slider button');
                el.click();

                // After clicking, the list of items shifts. We should update the
                // indicator and potentially re-scan for navigable elements.
                setTimeout(() => {
                    if (window.CouchBrowserSiteLogic && typeof window.CouchBrowserSiteLogic.update === 'function') {
                        window.CouchBrowserSiteLogic.update();
                    }
                }, 500);
            }
        },
        getContainer: getContainer
    });
})();
