/*
 * Omnibug dataLayer bridge — ISOLATED WORLD content script.
 *
 * Responsibilities:
 *   1. Inject the page-world monitor script (dataLayerMonitor.js) as early as possible
 *      so it can wrap dataLayer.push() before GTM does anything meaningful.
 *   2. Listen for postMessage events coming from that monitor and forward them
 *      to the service worker, where they're buffered per-tab and broadcast to popup/devtools.
 */
(function () {
    "use strict";

    // -----------------------------------------------------------------
    // 1. Inject the monitor into the page context
    // -----------------------------------------------------------------
    try {
        const scriptUrl = chrome.runtime.getURL("content/dataLayerMonitor.js");
        const el = document.createElement("script");
        el.src = scriptUrl;
        el.async = false;
        (document.head || document.documentElement).appendChild(el);
        el.addEventListener("load", function () { el.remove(); });
    } catch (e) {
        // Fall back silently: some pages with very strict CSP may block even this.
        // DevTools still works in that case; only the dataLayer view is affected.
        console.warn("Omnibug: could not inject dataLayer monitor", e);
    }

    // -----------------------------------------------------------------
    // 2. Relay messages from the page to the service worker
    // -----------------------------------------------------------------
    window.addEventListener("message", function (event) {
        // Only accept messages from the same window
        if (event.source !== window) { return; }
        const data = event.data;
        if (!data || data.__omnibug !== "dataLayerEvent") { return; }

        try {
            chrome.runtime.sendMessage({
                type: "dataLayerEvent",
                layer: data.layer,
                payload: data.payload,
                timestamp: data.timestamp,
                origin: data.origin,
                url: location.href
            }, function () {
                // Silently ignore "Could not establish connection" errors that
                // happen if the service worker is asleep. The event is buffered
                // only for active connections anyway.
                void chrome.runtime.lastError;
            });
        } catch (e) { /* extension context invalidated (e.g. reload) */ }
    });
})();
