(function() {
    // Default site configuration: pure generic behaviour from core.js.
    console.log('Couch Browser: Default config loaded');

    if (!window.CouchBrowser || typeof window.CouchBrowser.registerSite !== 'function') {
        console.warn('Couch Browser: core engine not loaded before site config');
        return;
    }

    window.CouchBrowser.registerSite({});
})();
