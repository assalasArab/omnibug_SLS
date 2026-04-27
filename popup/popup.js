/*
 * Omnibug popup — shows captured marketing hits AND dataLayer pushes
 * for the active tab, with intelligent correlation between them.
 */
(function () {
    "use strict";

    const state = {
        tabId: null,
        port: null,
        items: [],             // Unified list: mix of hits and dataLayer events
        debugEntries: [],      // Debug log entries (raw GA4-like requests)
        filter: "",
        mode: "all",           // "all" | "hits" | "datalayer" | "debug"
        providerFilter: "all", // "all" or a provider key (only used in hits mode)
        containerFilter: "all",// "all" or a GTM container ID
        showNoise: false,      // hide GA4 probe/heartbeat hits by default
        sortOrder: "desc",     // "desc" (newest first) | "asc" (oldest first)
        expanded: new Set(),
        dlViewMode: {},        // itemId -> "pretty" | "raw"
        hitViewMode: {},       // itemId -> "pretty" | "raw"
        theme: "auto",         // "auto" | "light" | "dark"
        isExpandedView: false, // Large popup mode
        nextId: 0,
        seqCounter: 0          // Incremental number shown in each item's badge
    };

    // DOM refs
    const el = {
        list: document.getElementById("timeline"),
        empty: document.getElementById("empty-state"),
        filter: document.getElementById("filter"),
        clear: document.getElementById("btn-clear"),
        settings: document.getElementById("btn-settings"),
        addEndpoint: document.getElementById("btn-add-endpoint"),
        theme: document.getElementById("btn-theme"),
        expand: document.getElementById("btn-expand"),
        status: document.getElementById("status"),
        tabs: document.querySelectorAll(".tab"),
        countAll: document.getElementById("count-all"),
        countHits: document.getElementById("count-hits"),
        countDl: document.getElementById("count-dl"),
        countDebug: document.getElementById("count-debug"),
        providerFilterBar: document.getElementById("provider-filter-bar"),
        providerSelect: document.getElementById("provider-select"),
        containerSelect: document.getElementById("container-select"),
        btnToggleNoise: document.getElementById("btn-toggle-noise"),
        noiseCount: document.getElementById("noise-count"),
        sortBtn: document.getElementById("btn-sort"),
        sortLabel: document.getElementById("sort-label"),
        quickAdd: document.getElementById("quick-add"),
        quickAddInput: document.getElementById("quick-add-input"),
        quickAddSave: document.getElementById("quick-add-save"),
        quickAddCancel: document.getElementById("quick-add-cancel")
    };

    init();

    async function init() {
        loadTheme();
        loadExpandedPreference();
        loadCustomSize();
        loadProviderFilterPreference();
        loadNoisePreference();

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            el.status.textContent = "No active tab";
            return;
        }
        state.tabId = tab.id;

        connect();
        attachUIHandlers();
        setupResizeHandle();
    }

    function connect() {
        try {
            state.port = chrome.runtime.connect({ name: "popup-" + state.tabId });
        } catch (e) {
            console.error("Failed to connect to service worker", e);
            el.status.textContent = "Disconnected";
            return;
        }

        state.port.onMessage.addListener(handleMessage);

        state.port.onDisconnect.addListener(() => {
            // Don't clear the list — just show reconnecting status. The service
            // worker may have idled (MV3) and is waking up; merging will happen
            // on the next "history" message.
            if (el.status) {
                el.status.classList.remove("connected");
                el.status.textContent = "Reconnecting…";
            }
            state.port = null;
            setTimeout(() => { if (!state.port) { connect(); } }, 300);
        });
    }

    function handleMessage(msg) {
        if (!msg || !msg.event) { return; }

        if (msg.event === "history") {
            // The service worker sends a fresh history snapshot on connect. We
            // merge it into our existing items rather than wiping — this matters
            // when the SW restarts (Manifest V3 idle eviction) and we'd otherwise
            // lose the entire visible list on every reconnect.
            const seenHitIds = new Set();
            const seenDlIds = new Set();
            state.items.forEach((it) => {
                if (it.kind === "hit" && it.url) {
                    seenHitIds.add(it.url + "::" + it.timestamp);
                }
                if (it.kind === "dl") {
                    seenDlIds.add((it.eventName || "") + "::" + it.timestamp);
                }
            });

            // Add only items we don't already have
            (msg.requests || []).forEach((r) => {
                const url = (r.request && r.request.url) || "";
                const ts = (r.request && r.request.timestamp) || 0;
                if (!seenHitIds.has(url + "::" + ts)) { addHit(r, false); }
            });
            (msg.dataLayerEvents || []).forEach((e) => {
                const en = extractEventName(e.payload) || "";
                const ts = e.timestamp || 0;
                if (!seenDlIds.has(en + "::" + ts)) { addDataLayerEvent(e, false); }
            });

            // Merge debug entries (dedup by seq)
            const existingSeqs = new Set(state.debugEntries.map((d) => d.seq));
            (msg.debugEntries || []).forEach((d) => {
                if (!existingSeqs.has(d.seq)) { state.debugEntries.push(d); }
            });

            // Status indicator: now connected
            if (el.status) {
                el.status.classList.add("connected");
                el.status.textContent = "Listening…";
            }

            recomputeCorrelations();
            render();
            return;
        }

        if (msg.event === "debugEntry" && msg.debugEntry) {
            state.debugEntries.push(msg.debugEntry);
            if (state.debugEntries.length > 200) {
                state.debugEntries.splice(0, state.debugEntries.length - 200);
            }
            // Only re-render if user is currently viewing debug tab
            if (state.mode === "debug") { render(); }
            else { updateCounts(); }
            return;
        }

        if (msg.event === "webRequest") {
            addHit(msg, false);
            recomputeCorrelations();
            render();
            return;
        }

        if (msg.event === "dataLayerEvent" && msg.dataLayerEvent) {
            addDataLayerEvent(msg.dataLayerEvent, false);
            recomputeCorrelations();
            render();
            return;
        }

        if (msg.event === "webNavigation") {
            // Keep history if the user opted in (service worker tells us via msg.keepHistory).
            // Otherwise clear the local view.
            if (!msg.keepHistory) {
                state.items = [];
                state.expanded.clear();
            } else {
                // Add a visual page-break separator so we know where the new page starts
                if (state.items.length > 0 && msg.request && msg.request.url) {
                    state.items.push({
                        id: ++state.nextId,
                        kind: "separator",
                        url: msg.request.url,
                        timestamp: msg.request.timestamp || Date.now()
                    });
                }
            }
            render();
        }
    }

    /* ---------------------------------------------------------------
     * Event categorization — colored badges like datalayer checker
     * ---------------------------------------------------------------
     * Maps a hit's requestType or a dataLayer event name to a category.
     * Each category has its own color. The badge on the left side of
     * each item takes this color + shows a sequence number.
     *
     * Categories:
     *   - "page"      green   — page_view, pageview
     *   - "commerce"  red     — purchase, add_to_cart, begin_checkout, etc.
     *   - "product"   yellow  — view_item, view_item_list, view_cart, etc.
     *   - "user"      purple  — login, sign_up, user_*
     *   - "system"    gray    — gtm.js, gtm.dom, gtm.load, scrollDepth, etc.
     *   - "config"    blue    — config.*, js.*
     *   - "custom"    teal    — everything else
     */
    function categorizeEventName(name) {
        if (!name) { return "custom"; }
        const n = String(name).toLowerCase();

        // System / GTM internals — checked FIRST so events like "gtm.click",
        // "gtm.scroll", "gtm.formSubmit" don't fall into the UI category below.
        if (n.indexOf("gtm.") === 0) { return "system"; }
        if (n === "timer" || n === "historychange" || n === "history_change" ||
            n === "formsubmit" || n === "form_submit") { return "system"; }

        // Page views — covers GA4, Facebook Pixel, Adobe, etc.
        if (n === "page_view" || n === "pageview" || n === "page view" || n === "page-view") { return "page"; }
        if (n.indexOf("page view") !== -1 || n.indexOf("pageview") !== -1) { return "page"; }

        // Ecommerce conversion events
        const commerceExact = [
            "purchase", "refund", "addtocart",
            "add_to_cart", "remove_from_cart",
            "begin_checkout", "add_shipping_info", "add_payment_info",
            "initiatecheckout", "initiate_checkout",
            "add_to_wishlist", "addtowishlist",
            "select_item", "select_promotion",
            "generate_lead", "sign_up",
            "completeregistration", "startcheckout"
        ];
        if (commerceExact.indexOf(n) !== -1) { return "commerce"; }
        if (n.indexOf("purchase") !== -1 || n.indexOf("checkout") !== -1 ||
            n.indexOf("transaction") !== -1 || n.indexOf("addtocart") !== -1 ||
            n.indexOf("add_to_cart") !== -1 || n.indexOf("add to cart") !== -1) {
            return "commerce";
        }

        // Product views
        const productExact = [
            "view_item", "view_item_list", "view_cart", "view_promotion",
            "view_search_results", "viewcontent", "view_content",
            "view content", "product view", "productview"
        ];
        if (productExact.indexOf(n) !== -1) { return "product"; }
        if (n.indexOf("view_item") !== -1 || n.indexOf("viewcontent") !== -1) {
            return "product";
        }

        // User
        if (n === "login" || n === "logout" || n === "sign_in" || n === "signin" || n === "signup") { return "user"; }
        if (n.indexOf("user_") === 0 || n.indexOf("user.") === 0 || n.indexOf("event.detect_user") !== -1) { return "user"; }
        if (n.indexOf("user_properties") !== -1 || n.indexOf("set_user") !== -1) { return "user"; }

        // Search
        if (n === "search" || n === "view_search_results") { return "product"; }

        // UI interaction — very common on modern sites where "click"/"scroll" are generic containers
        const uiExact = [
            "click", "scroll", "scrolldepth", "scroll_depth",
            "view", "open", "close", "toggle", "expand", "collapse",
            "select", "submit", "focus", "blur", "hover", "tap",
            "video_start", "video_progress", "video_complete",
            "file_download", "download", "share", "outbound_click"
        ];
        if (uiExact.indexOf(n) !== -1) { return "ui"; }
        if (n.indexOf("click") !== -1 || n.indexOf("scroll") !== -1 ||
            n.indexOf("toggle") !== -1 || n.indexOf("open") !== -1 ||
            n.indexOf("close") !== -1) { return "ui"; }

        // Config
        if (n.indexOf("config.") === 0 || n.indexOf("config ") === 0) { return "config"; }
        if (n.indexOf("js.") === 0 || n.indexOf("js ") === 0) { return "config"; }

        // Tag activation events (common GTM patterns: "[.F (gtag)", etc.)
        if (n.indexOf("(gtag)") !== -1 || n.indexOf("(gtm)") !== -1) { return "config"; }

        return "custom";
    }

    /* ---------------------------------------------------------------
     * Expanded window mode — larger popup for more space
     * --------------------------------------------------------------- */
    function loadExpandedPreference() {
        try {
            const saved = localStorage.getItem("omnibug_expanded");
            state.isExpandedView = saved === "1";
        } catch (e) { /* ignore */ }
        applyExpandedView();
    }

    function applyExpandedView() {
        document.body.classList.toggle("expanded-view", state.isExpandedView);
    }

    function toggleExpandedView() {
        // Toggling presets clears any user-customized size from a previous drag
        clearCustomSize();
        state.isExpandedView = !state.isExpandedView;
        try { localStorage.setItem("omnibug_expanded", state.isExpandedView ? "1" : "0"); } catch (e) { /* ignore */ }
        applyExpandedView();
    }

    /* ---------------------------------------------------------------
     * Custom-size handling — user-resizable popup via drag handle
     * Stores width and maxHeight in localStorage so the popup remembers
     * its size between openings.
     * --------------------------------------------------------------- */
    function loadCustomSize() {
        try {
            const w = parseInt(localStorage.getItem("omnibug_custom_width"), 10);
            const h = parseInt(localStorage.getItem("omnibug_custom_height"), 10);
            if (!isNaN(w) && w >= 360 && w <= 1200 &&
                !isNaN(h) && h >= 220 && h <= 800) {
                applyCustomSize(w, h);
            }
        } catch (e) { /* ignore */ }
    }

    function applyCustomSize(width, height) {
        document.documentElement.classList.add("custom-sized");
        document.body.classList.add("custom-sized");
        // Apply to both html and body so the entire popup window resizes,
        // not just the inner content area.
        document.documentElement.style.width = width + "px";
        document.documentElement.style.height = height + "px";
        document.body.style.width = width + "px";
        document.body.style.height = height + "px";
        document.body.style.maxHeight = height + "px";
        document.body.style.minHeight = "0";
    }

    function saveCustomSize(width, height) {
        try {
            localStorage.setItem("omnibug_custom_width", String(width));
            localStorage.setItem("omnibug_custom_height", String(height));
        } catch (e) { /* ignore */ }
    }

    function clearCustomSize() {
        document.documentElement.classList.remove("custom-sized");
        document.body.classList.remove("custom-sized");
        document.documentElement.style.removeProperty("width");
        document.documentElement.style.removeProperty("height");
        document.body.style.removeProperty("width");
        document.body.style.removeProperty("height");
        document.body.style.removeProperty("max-height");
        document.body.style.removeProperty("min-height");
        try {
            localStorage.removeItem("omnibug_custom_width");
            localStorage.removeItem("omnibug_custom_height");
        } catch (e) { /* ignore */ }
    }

    function setupResizeHandle() {
        const handle = document.getElementById("resize-handle");
        if (!handle) { return; }

        let dragging = false;
        let startX = 0, startY = 0;
        let startW = 0, startH = 0;

        // Constraints: respect Chrome's popup max (~800x600 typical),
        // but allow up to 1200x800 in case the browser grants more.
        const MIN_W = 360, MAX_W = 1200;
        const MIN_H = 220, MAX_H = 800;

        const onMouseMove = (e) => {
            if (!dragging) { return; }
            const newW = Math.max(MIN_W, Math.min(MAX_W, startW + (e.clientX - startX)));
            const newH = Math.max(MIN_H, Math.min(MAX_H, startH + (e.clientY - startY)));
            applyCustomSize(newW, newH);
        };

        const onMouseUp = () => {
            if (!dragging) { return; }
            dragging = false;
            document.body.classList.remove("is-resizing");
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);

            // Save the final dimensions
            const finalW = document.body.getBoundingClientRect().width;
            const finalH = document.body.getBoundingClientRect().height;
            saveCustomSize(Math.round(finalW), Math.round(finalH));
        };

        handle.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = document.body.getBoundingClientRect();
            startW = rect.width;
            startH = rect.height;
            document.body.classList.add("is-resizing");
            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });

        // Double-click handle to reset to default
        handle.addEventListener("dblclick", (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearCustomSize();
            applyExpandedView();  // re-apply the preset width
        });
    }

    /* ---------------------------------------------------------------
     * Theme handling — light / dark / auto (follow system)
     * --------------------------------------------------------------- */
    function loadTheme() {
        try {
            const saved = localStorage.getItem("omnibug_theme");
            if (saved === "light" || saved === "dark" || saved === "auto") {
                state.theme = saved;
            }
        } catch (e) { /* private mode / storage denied */ }
        applyTheme();
    }

    function applyTheme() {
        const root = document.documentElement;
        root.removeAttribute("data-theme");
        if (state.theme === "light" || state.theme === "dark") {
            root.setAttribute("data-theme", state.theme);
        }
        // Update icon
        const iconLight = document.getElementById("theme-icon-light");
        const iconDark = document.getElementById("theme-icon-dark");
        if (iconLight && iconDark) {
            // Show the icon that represents CURRENT mode (what will be toggled AWAY from)
            const effective = state.theme === "auto"
                ? (matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
                : state.theme;
            iconLight.style.display = effective === "light" ? "" : "none";
            iconDark.style.display = effective === "dark" ? "" : "none";
        }
    }

    function toggleTheme() {
        // Cycle: auto → light → dark → auto
        const order = ["auto", "light", "dark"];
        const idx = order.indexOf(state.theme);
        state.theme = order[(idx + 1) % order.length];
        try { localStorage.setItem("omnibug_theme", state.theme); } catch (e) { /* ignore */ }
        applyTheme();
    }

    /* ---------------------------------------------------------------
     * Ingest & normalize items
     * --------------------------------------------------------------- */

    function addHit(raw, shouldRender) {
        const hit = normalizeHit(raw, ++state.nextId);
        state.items.push(hit);
        if (shouldRender) { render(); }
    }

    function normalizeHit(raw, id) {
        const provider = raw.provider || {};
        const data = Array.isArray(raw.data) ? raw.data : [];
        const columns = provider.columns || {};

        const accountKey = columns.account;
        const requestTypeKey = columns.requestType;

        let account = "";
        let requestType = "";
        const byKey = {};
        data.forEach((p) => {
            if (p && p.key != null) { byKey[p.key] = p.value; }
        });
        if (accountKey && byKey[accountKey] != null) { account = String(byKey[accountKey]); }
        if (requestTypeKey && byKey[requestTypeKey] != null) { requestType = String(byKey[requestTypeKey]); }
        if (!requestType) {
            if (byKey["en"]) { requestType = String(byKey["en"]); }
            else if (byKey["pagename"] || byKey["pageName"]) { requestType = "page view"; }
            else { requestType = "request"; }
        }

        // Detect "noise" hits — GA4 SDK heartbeats/probes/keepalives that have no
        // meaningful event content. Common signature:
        //   - URL on region1.analytics.google.com / *.analytics.google.com
        //   - Path is /g/s/collect (server-side probe) or contains _is_sw=
        //   - No `en=` param, no `t=` param, no event payload (just session/consent flags)
        //   - GA4 provider gives them requestType "Other" / "request" / "page view"
        // These add noise without diagnostic value, so we hide them by default.
        const url = (raw.request && raw.request.url) || "";
        const hasMeaningfulEvent = byKey["en"] || byKey["t"] ||
                                   Object.keys(byKey).some((k) => /^en\[\d+]$/.test(k));
        const isProbeUrl = /\.analytics\.google\.com\/g\/s\/collect/i.test(url) ||
                           /[?&]_is_sw=/i.test(url);
        const isNoise = isProbeUrl && !hasMeaningfulEvent && (
            requestType === "request" ||
            requestType === "page view" ||
            requestType === "Other" ||
            requestType.toLowerCase() === "other"
        );

        // Extract GTM container ID from common parameter names.
        // GA4 with GTM exposes ep.container_id (e.g. "GTM-MT2LZPB").
        // Some sites use container_id without the ep. prefix in custom dimensions.
        let containerId = "";
        const containerCandidates = [
            "ep.container_id",
            "ep.gtm_container_id",
            "container_id",
            "ep.gtm_id",
            "gtm_id"
        ];
        for (let i = 0; i < containerCandidates.length; i++) {
            const v = byKey[containerCandidates[i]];
            if (v) { containerId = String(v); break; }
        }
        // Fallback: GA4's `gtm` parameter contains a fingerprint, but if the hit
        // came from a tag firing through GTM we may also find the GTM-XXX in the URL
        // (e.g. some sites embed it in the page URL). Skip that — too noisy.

        return {
            id: id,
            seq: ++state.seqCounter,
            kind: "hit",
            providerKey: provider.key || "UNKNOWN",
            providerName: provider.name || "Unknown",
            providerType: provider.type || "",
            requestType: requestType,
            account: account,
            containerId: containerId,
            isNoise: isNoise,
            url: (raw.request && raw.request.url) || "",
            method: (raw.request && raw.request.method) || "GET",
            timestamp: (raw.request && raw.request.timestamp) || Date.now(),
            groups: provider.groups || [],
            data: data,
            category: categorizeEventName(requestType),
            // Filled by recomputeCorrelations()
            triggeredBy: null   // id of a dataLayer event
        };
    }

    function addDataLayerEvent(raw, shouldRender) {
        const eventName = extractEventName(raw.payload);
        const ev = {
            id: ++state.nextId,
            seq: ++state.seqCounter,
            kind: "dl",
            layer: raw.layer || "dataLayer",
            payload: raw.payload || {},
            timestamp: raw.timestamp || Date.now(),
            origin: raw.origin || "push",
            // Try to identify the event name for correlation
            eventName: eventName,
            category: categorizeEventName(eventName),
            // Filled by recomputeCorrelations()
            triggeredHits: []   // list of hit ids triggered after this push
        };
        state.items.push(ev);
        if (shouldRender) { render(); }
    }

    /**
     * Extract the "event name" from a dataLayer payload.
     * Supports GTM-style `{event: "xxx"}` and a few fallbacks.
     */
    function extractEventName(payload) {
        if (!payload || typeof payload !== "object") { return ""; }
        if (typeof payload.event === "string") { return payload.event; }
        if (typeof payload.eventName === "string") { return payload.eventName; }
        // Adobe CEDDL style
        if (payload.eventInfo && typeof payload.eventInfo.eventName === "string") {
            return payload.eventInfo.eventName;
        }
        // GTM.push array syntax: ['config', 'G-XXX']
        if (Array.isArray(payload) && typeof payload[0] === "string") {
            return payload[0];
        }
        return "";
    }

    /* ---------------------------------------------------------------
     * Correlation logic
     * ---------------------------------------------------------------
     * A hit is "triggered by" a dataLayer push when:
     *   - The push happened BEFORE the hit
     *   - The delta is <= CORRELATION_WINDOW_MS (2s)
     *   - AND either the hit's event name matches the dataLayer event name
     *     OR the push is the most recent within 500ms (proximity-based)
     */
    const CORRELATION_WINDOW_MS = 2000;
    const CORRELATION_PROXIMITY_MS = 500;

    function recomputeCorrelations() {
        // Reset all correlation state
        state.items.forEach((it) => {
            if (it.kind === "hit") { it.triggeredBy = null; }
            else if (it.kind === "dl") { it.triggeredHits = []; }
        });

        // Work on a time-sorted ASC copy (oldest first)
        const sorted = state.items.slice().sort((a, b) => a.timestamp - b.timestamp);

        sorted.forEach((item) => {
            if (item.kind !== "hit") { return; }

            // Scan backwards for candidate dataLayer pushes
            let bestMatch = null;       // exact event-name match (strong)
            let bestProximity = null;   // nearest in time within proximity window

            for (let i = sorted.length - 1; i >= 0; i--) {
                const other = sorted[i];
                if (other.kind !== "dl") { continue; }
                if (other.timestamp > item.timestamp) { continue; }
                const delta = item.timestamp - other.timestamp;
                if (delta > CORRELATION_WINDOW_MS) { break; }

                // Event name match?
                if (other.eventName && eventNamesMatch(other.eventName, item.requestType)) {
                    if (!bestMatch || (item.timestamp - bestMatch.timestamp) > delta) {
                        bestMatch = other;
                    }
                }
                // Proximity fallback — closest dataLayer push within 500ms
                if (delta <= CORRELATION_PROXIMITY_MS) {
                    if (!bestProximity || (item.timestamp - bestProximity.timestamp) > delta) {
                        bestProximity = other;
                    }
                }
            }

            const match = bestMatch || bestProximity;
            if (match) {
                item.triggeredBy = match.id;
                match.triggeredHits.push(item.id);
            }
        });
    }

    /**
     * Compare two event names with loose matching (case-insensitive, normalized).
     */
    function eventNamesMatch(a, b) {
        if (!a || !b) { return false; }
        const na = String(a).toLowerCase().replace(/[_\-\s]+/g, "");
        const nb = String(b).toLowerCase().replace(/[_\-\s]+/g, "");
        if (na === nb) { return true; }
        // Sometimes dataLayer has "gtm.click" while hit has "click" etc.
        if (na.endsWith("." + nb) || nb.endsWith("." + na)) { return true; }
        return false;
    }

    /* ---------------------------------------------------------------
     * Rendering
     * --------------------------------------------------------------- */
    function updateCounts() {
        const hitCount = state.items.filter((it) => it.kind === "hit").length;
        const dlCount = state.items.filter((it) => it.kind === "dl").length;
        const noiseCount = state.items.filter((it) => it.kind === "hit" && it.isNoise).length;
        el.countAll.textContent = (hitCount + dlCount);
        el.countHits.textContent = hitCount;
        el.countDl.textContent = dlCount;
        if (el.countDebug) { el.countDebug.textContent = state.debugEntries.length; }

        // Noise toggle: show count and update label
        if (el.btnToggleNoise && el.noiseCount) {
            el.noiseCount.textContent = noiseCount;
            const label = el.btnToggleNoise.querySelector(".noise-toggle-label");
            if (label) {
                label.textContent = state.showNoise ? "Hide noise" : "Show noise";
            }
            el.btnToggleNoise.classList.toggle("active", state.showNoise);
            // Hide button entirely if there's no noise to filter
            el.btnToggleNoise.style.display = noiseCount > 0 ? "" : "none";
        }
    }

    function render() {
        // Update counts always
        updateCounts();
        updateProviderFilterDropdown();
        updateContainerFilterDropdown();

        // Debug mode: render the raw debug log instead of normalized items
        if (state.mode === "debug") {
            renderDebugView();
            return;
        }

        const filter = state.filter.toLowerCase().trim();

        let visible = state.items.slice();

        // Mode filter (separators always stay visible in "all" mode to mark page breaks)
        if (state.mode === "hits") { visible = visible.filter((it) => it.kind === "hit"); }
        else if (state.mode === "datalayer") { visible = visible.filter((it) => it.kind === "dl"); }

        // Hide noise hits (probes/heartbeats with no event) unless user opts in
        if (!state.showNoise) {
            visible = visible.filter((it) => !(it.kind === "hit" && it.isNoise));
        }

        // Provider filter (only effective in Hits mode)
        if (state.mode === "hits" && state.providerFilter !== "all") {
            visible = visible.filter((it) => it.providerKey === state.providerFilter);
        }

        // Container filter (only effective in Hits mode)
        if (state.mode === "hits" && state.containerFilter !== "all") {
            visible = visible.filter((it) => it.containerId === state.containerFilter);
        }

        // Text filter (separators stay)
        if (filter) { visible = visible.filter((it) => it.kind === "separator" || itemMatchesFilter(it, filter)); }

        // Sort order
        if (state.sortOrder === "asc") {
            visible.sort((a, b) => a.timestamp - b.timestamp);
        } else {
            visible.sort((a, b) => b.timestamp - a.timestamp);
        }

        // Counts already updated by updateCounts() above

        // Empty state
        if (visible.length === 0) {
            el.empty.classList.remove("hidden");
            el.list.innerHTML = "";
            return;
        }
        el.empty.classList.add("hidden");

        el.list.innerHTML = "";
        const frag = document.createDocumentFragment();
        visible.forEach((it) => {
            if (it.kind === "hit") { frag.appendChild(renderHitItem(it)); }
            else if (it.kind === "dl") { frag.appendChild(renderDlItem(it)); }
            else if (it.kind === "separator") { frag.appendChild(renderSeparator(it)); }
        });
        el.list.appendChild(frag);
    }

    function renderSeparator(sep) {
        const li = document.createElement("li");
        li.className = "page-separator";
        const label = document.createElement("span");
        label.className = "page-separator-label";
        let hostPath = sep.url || "";
        try {
            const u = new URL(sep.url);
            hostPath = u.hostname + u.pathname;
        } catch (e) { /* keep raw */ }
        label.textContent = "↓  " + hostPath;
        li.appendChild(label);
        return li;
    }

    /* ---------------------------------------------------------------
     * Debug view — raw GA4-like requests for diagnosis
     * --------------------------------------------------------------- */
    function renderDebugView() {
        if (state.debugEntries.length === 0) {
            el.empty.classList.remove("hidden");
            el.list.innerHTML = "";
            return;
        }
        el.empty.classList.add("hidden");

        // Sort
        const entries = state.debugEntries.slice();
        if (state.sortOrder === "asc") { entries.sort((a, b) => a.timestamp - b.timestamp); }
        else { entries.sort((a, b) => b.timestamp - a.timestamp); }

        el.list.innerHTML = "";
        const frag = document.createDocumentFragment();
        entries.forEach((entry) => frag.appendChild(renderDebugEntry(entry)));
        el.list.appendChild(frag);
    }

    function renderDebugEntry(entry) {
        const li = document.createElement("li");
        li.className = "item debug-entry " + (entry.matched ? "matched" : "unmatched");
        if (state.expanded.has("dbg-" + entry.seq)) { li.classList.add("expanded"); }

        const summary = document.createElement("div");
        summary.className = "item-summary";

        // Status badge: green checkmark if matched, red cross if not
        const badge = document.createElement("span");
        badge.className = "seq-badge " + (entry.matched ? "cat-page" : "cat-commerce");
        badge.textContent = entry.matched ? "✓" : "✗";
        badge.title = entry.matched ? "Captured by Omnibug" : "NOT captured (would not appear in Hits tab)";
        summary.appendChild(badge);

        // Title: event names
        const title = document.createElement("span");
        title.className = "item-title";
        let titleText = entry.eventNameInUrl || entry.eventNameInPost || "(no event name)";
        if (entry.batchEventCount > 1) {
            titleText = "[batch " + entry.batchEventCount + "] " + titleText;
        }
        title.textContent = titleText;
        summary.appendChild(title);

        const tag = document.createElement("span");
        tag.className = "item-tag";
        tag.textContent = entry.method;
        summary.appendChild(tag);

        summary.addEventListener("click", () => {
            const key = "dbg-" + entry.seq;
            if (state.expanded.has(key)) { state.expanded.delete(key); }
            else { state.expanded.add(key); }
            render();
        });

        li.appendChild(summary);

        if (state.expanded.has("dbg-" + entry.seq)) {
            li.appendChild(renderDebugDetails(entry));
        }

        return li;
    }

    function renderDebugDetails(entry) {
        const wrap = document.createElement("div");
        wrap.className = "item-details";

        // Diagnosis section
        const diag = document.createElement("div");
        diag.className = "context-section";
        const diagHeading = document.createElement("div");
        diagHeading.className = "context-heading";
        diagHeading.textContent = "Diagnosis";
        diag.appendChild(diagHeading);

        const grid = document.createElement("div");
        grid.className = "context-grid";

        const rows = [
            ["Captured?", entry.matched ? "✓ YES — appears in Hits tab" : "✗ NO — filtered out somewhere"],
            ["Method", entry.method],
            ["Time", new Date(entry.timestamp).toLocaleTimeString()],
            ["Event in URL", entry.eventNameInUrl || "(none)"],
            ["Event in POST", entry.eventNameInPost || "(none)"],
            ["Is batch?", entry.isBatch ? "YES — multiple events in one POST" : "no"],
            ["Batch count", String(entry.batchEventCount)]
        ];
        rows.forEach(([k, v]) => {
            const ke = document.createElement("div"); ke.className = "context-key"; ke.textContent = k;
            const ve = document.createElement("div"); ve.className = "context-value"; ve.textContent = v;
            grid.appendChild(ke); grid.appendChild(ve);
        });
        diag.appendChild(grid);
        wrap.appendChild(diag);

        // URL
        const urlLabel = document.createElement("div");
        urlLabel.className = "group-title";
        urlLabel.textContent = "URL";
        wrap.appendChild(urlLabel);
        const urlBox = document.createElement("div");
        urlBox.className = "item-url";
        urlBox.textContent = entry.url;
        wrap.appendChild(urlBox);

        // POST body (if any)
        if (entry.postData) {
            const postLabel = document.createElement("div");
            postLabel.className = "group-title";
            postLabel.textContent = "POST body (" + (entry.postData.length) + " chars)";
            wrap.appendChild(postLabel);

            const postBox = document.createElement("pre");
            postBox.className = "json-view";
            postBox.style.maxHeight = "200px";
            postBox.textContent = entry.postData;
            wrap.appendChild(postBox);
        }

        // Copy button
        const copyBtn = document.createElement("button");
        copyBtn.className = "view-btn active";
        copyBtn.style.marginTop = "8px";
        copyBtn.textContent = "Copy diagnostic info";
        copyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const text = JSON.stringify(entry, null, 2);
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.textContent = "Copied ✓";
                setTimeout(() => { copyBtn.textContent = "Copy diagnostic info"; }, 1500);
            });
        });
        wrap.appendChild(copyBtn);

        return wrap;
    }

    function itemMatchesFilter(item, filter) {
        if (item.kind === "hit") {
            if (item.providerName.toLowerCase().includes(filter)) { return true; }
            if (item.requestType.toLowerCase().includes(filter)) { return true; }
            if (item.account.toLowerCase().includes(filter)) { return true; }
            if (item.containerId && item.containerId.toLowerCase().includes(filter)) { return true; }
            if (item.url.toLowerCase().includes(filter)) { return true; }
            for (let i = 0; i < item.data.length; i++) {
                const p = item.data[i];
                if (!p) { continue; }
                if (String(p.key || "").toLowerCase().includes(filter)) { return true; }
                if (String(p.field || "").toLowerCase().includes(filter)) { return true; }
                if (String(p.value || "").toLowerCase().includes(filter)) { return true; }
            }
            return false;
        } else {
            if (item.layer.toLowerCase().includes(filter)) { return true; }
            if (item.eventName.toLowerCase().includes(filter)) { return true; }
            try {
                if (JSON.stringify(item.payload).toLowerCase().includes(filter)) { return true; }
            } catch (e) { /* ignore */ }
            return false;
        }
    }

    /* ----------- Hit item rendering ----------- */

    function renderHitItem(hit) {
        const li = document.createElement("li");
        li.className = "item hit";
        li.dataset.id = String(hit.id);
        if (state.expanded.has(hit.id)) { li.classList.add("expanded"); }

        li.appendChild(buildSummary(hit, {
            iconSrc: "../assets/images/icons/" + hit.providerKey + "16x16.png",
            fallbackLetter: (hit.providerName || "?").charAt(0).toUpperCase(),
            kindLabel: hit.providerName,
            eventLabel: hit.requestType,
            subtitle: hit.account || hit.url.replace(/^https?:\/\//, "").split(/[?#]/)[0],
            containerId: hit.containerId
        }));

        // Only render details (incl. correlation) when expanded — keeps the list clean
        if (state.expanded.has(hit.id)) {
            li.appendChild(renderHitDetails(hit));
        }

        return li;
    }

    function renderHitDetails(hit) {
        const wrap = document.createElement("div");
        wrap.className = "item-details";

        // Correlation pill (if any)
        if (hit.triggeredBy) {
            const parent = state.items.find((x) => x.id === hit.triggeredBy);
            if (parent) {
                const corr = document.createElement("div");
                corr.className = "correlation";
                const pill = buildPill("from-dl", "⟵ from dataLayer: " + (parent.eventName || "push"), parent.id);
                corr.appendChild(pill);
                wrap.appendChild(corr);
            }
        }

        // Actions bar: Pretty/Raw toggle + Copy buttons
        const viewMode = state.hitViewMode[hit.id] || "pretty";
        const actionsBar = document.createElement("div");
        actionsBar.className = "actions-bar";

        // View toggle group
        const toggle = document.createElement("div");
        toggle.className = "view-toggle";
        const btnPretty = document.createElement("button");
        btnPretty.className = "view-btn" + (viewMode === "pretty" ? " active" : "");
        btnPretty.textContent = "Readable";
        btnPretty.addEventListener("click", (e) => {
            e.stopPropagation();
            state.hitViewMode[hit.id] = "pretty";
            render();
        });
        toggle.appendChild(btnPretty);
        const btnRaw = document.createElement("button");
        btnRaw.className = "view-btn" + (viewMode === "raw" ? " active" : "");
        btnRaw.textContent = "Raw";
        btnRaw.addEventListener("click", (e) => {
            e.stopPropagation();
            state.hitViewMode[hit.id] = "raw";
            render();
        });
        toggle.appendChild(btnRaw);
        actionsBar.appendChild(toggle);

        // Copy buttons group
        const copyGroup = document.createElement("div");
        copyGroup.className = "copy-group";

        copyGroup.appendChild(buildCopyButton("JSON", () => buildHitJSON(hit)));
        copyGroup.appendChild(buildCopyButton("URL", () => hit.url));
        copyGroup.appendChild(buildCopyButton("cURL", () => buildHitCurl(hit)));

        actionsBar.appendChild(copyGroup);
        wrap.appendChild(actionsBar);

        if (viewMode === "raw") {
            // Raw view: just URL + raw query/post key=value pairs
            wrap.appendChild(renderHitRaw(hit));
            return wrap;
        }

        // Pretty view (default):
        // 1. dataLayer match BUTTON (opens slide panel) — only if a push is correlated
        // 2. context section (highlight key semantic fields)
        // 3. URL + decoded params grouped

        const dlMatchButton = buildDataLayerMatchButton(hit);
        if (dlMatchButton) { wrap.appendChild(dlMatchButton); }

        // "Context" section: highlight the most meaningful fields first
        const contextSection = buildHitContextSection(hit);
        if (contextSection) { wrap.appendChild(contextSection); }

        // Meta line: method + timestamp + provider
        const meta = document.createElement("div");
        meta.className = "item-meta-line";
        meta.textContent = hit.providerName + " · " + hit.method + " · " + new Date(hit.timestamp).toLocaleTimeString();
        wrap.appendChild(meta);

        const urlBox = document.createElement("div");
        urlBox.className = "item-url";
        urlBox.textContent = hit.url;
        wrap.appendChild(urlBox);

        // Group parameters by `group`
        const groupsMap = {};
        hit.data.forEach((p) => {
            if (!p) { return; }
            const g = p.group || "other";
            if (!groupsMap[g]) { groupsMap[g] = []; }
            groupsMap[g].push(p);
        });

        const definedKeys = (hit.groups || []).map((g) => g.key);
        const orderedKeys = definedKeys.filter((k) => groupsMap[k]);
        Object.keys(groupsMap).forEach((k) => {
            if (orderedKeys.indexOf(k) === -1) { orderedKeys.push(k); }
        });

        if (orderedKeys.length === 0) {
            const none = document.createElement("div");
            none.className = "param-value empty";
            none.textContent = "No parameters decoded.";
            wrap.appendChild(none);
            return wrap;
        }

        orderedKeys.forEach((key) => {
            const groupMeta = (hit.groups || []).find((g) => g.key === key);
            const title = document.createElement("div");
            title.className = "group-title";
            title.textContent = (groupMeta && groupMeta.name) || prettify(key);
            wrap.appendChild(title);

            const grid = document.createElement("div");
            grid.className = "params";

            const params = groupsMap[key].slice().sort((a, b) => {
                const fa = String(a.field || a.key || "").toLowerCase();
                const fb = String(b.field || b.key || "").toLowerCase();
                return fa < fb ? -1 : fa > fb ? 1 : 0;
            });

            params.forEach((p) => {
                const keyEl = document.createElement("div");
                keyEl.className = "param-key";
                keyEl.title = p.key + (p.field && p.field !== p.key ? " (" + p.field + ")" : "");
                keyEl.textContent = cleanParamLabel(p.field || p.key || "");

                const valEl = document.createElement("div");
                valEl.className = "param-value";
                const v = p.value == null ? "" : String(p.value);
                if (v === "") {
                    valEl.classList.add("empty");
                    valEl.textContent = "(empty)";
                } else {
                    valEl.textContent = v;
                }

                grid.appendChild(keyEl);
                grid.appendChild(valEl);
            });

            wrap.appendChild(grid);
        });

        return wrap;
    }

    /**
     * Raw view of a hit: just the URL and key=value pairs as they appear on the wire,
     * without translation/grouping.
     */
    function renderHitRaw(hit) {
        const wrap = document.createElement("div");

        // Method + URL
        const meta = document.createElement("div");
        meta.className = "item-meta-line";
        meta.textContent = hit.method + " · " + new Date(hit.timestamp).toLocaleTimeString();
        wrap.appendChild(meta);

        const urlBox = document.createElement("div");
        urlBox.className = "item-url";
        urlBox.textContent = hit.url;
        wrap.appendChild(urlBox);

        // Raw params list — numbered like the screenshot you showed
        const heading = document.createElement("div");
        heading.className = "group-title";
        heading.textContent = "Parameters (" + hit.data.length + ")";
        wrap.appendChild(heading);

        const list = document.createElement("ol");
        list.className = "raw-params";
        hit.data.forEach((p) => {
            if (!p || p.key == null) { return; }
            const li = document.createElement("li");
            const k = document.createElement("span");
            k.className = "raw-param-key";
            k.textContent = String(p.key);
            const v = document.createElement("span");
            v.className = "raw-param-value";
            const val = (p.value == null || p.value === "") ? "(empty)" : String(p.value);
            v.textContent = val;
            if (p.value === "" || p.value == null) { v.classList.add("empty"); }
            li.appendChild(k);
            li.appendChild(v);
            list.appendChild(li);
        });
        wrap.appendChild(list);

        return wrap;
    }

    /* ---------------------------------------------------------------
     * Copy helpers
     * --------------------------------------------------------------- */

    /**
     * Build a small button that copies text to the clipboard.
     * Shows a brief "Copied ✓" confirmation.
     */
    function buildCopyButton(label, getText) {
        const btn = document.createElement("button");
        btn.className = "copy-btn";
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right:4px;vertical-align:-1px"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg><span>' + label + '</span>';
        btn.title = "Copy " + label.toLowerCase();
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            let text;
            try { text = getText(); } catch (err) { text = "(error: " + err.message + ")"; }

            const finish = (ok) => {
                const span = btn.querySelector("span");
                const original = label;
                if (span) {
                    span.textContent = ok ? "Copied" : "Failed";
                    btn.classList.add(ok ? "copied" : "failed");
                    setTimeout(() => {
                        span.textContent = original;
                        btn.classList.remove("copied", "failed");
                    }, 1500);
                }
            };

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => finish(true), () => finish(false));
            } else {
                // Fallback for older environments
                try {
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    ta.style.position = "fixed";
                    ta.style.left = "-9999px";
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand("copy");
                    document.body.removeChild(ta);
                    finish(true);
                } catch (err) { finish(false); }
            }
        });
        return btn;
    }

    /**
     * Build a clean JSON representation of a hit, suitable for sharing
     * or pasting into a ticket.
     */
    function buildHitJSON(hit) {
        const params = {};
        hit.data.forEach((p) => {
            if (p && p.key != null) { params[p.key] = p.value; }
        });
        const obj = {
            provider: hit.providerName,
            event: hit.requestType,
            account: hit.account || undefined,
            method: hit.method,
            url: hit.url,
            timestamp: new Date(hit.timestamp).toISOString(),
            parameters: params
        };
        return JSON.stringify(obj, null, 2);
    }

    /**
     * Build a curl command that reproduces the hit. Useful for replaying or
     * inspecting from the terminal.
     */
    function buildHitCurl(hit) {
        const lines = ["curl '" + hit.url.replace(/'/g, "'\\''") + "'"];
        lines.push("  -X " + hit.method);
        // Common headers GA4 sends
        lines.push("  -H 'content-type: text/plain;charset=UTF-8'");
        // Include POST data for non-GET requests if we have it as a string
        // Note: Omnibug strips post body in normalized hits; we only have URL params reliably
        return lines.join(" \\\n");
    }

    /**
     * Build a JS snippet to replay a dataLayer push (useful for QA reproductions).
     */
    function buildDlPushSnippet(ev) {
        const layer = ev.layer || "dataLayer";
        const json = JSON.stringify(ev.payload, null, 2);
        return "window." + layer + " = window." + layer + " || [];\nwindow." + layer + ".push(" + json + ");";
    }

    /**
     * Strip GA4-provider noise from parameter labels.
     * Examples:
     *   "Event 1 Data (event_category)" -> "event_category"
     *   "Event 1 Data (cta_clicked)"    -> "cta_clicked"
     *   "Custom Dimension 5"            -> "Custom Dimension 5" (unchanged)
     *   "Page URL"                      -> "Page URL"          (unchanged)
     */
    function cleanParamLabel(label) {
        if (!label) { return ""; }
        // Match "Event N Data (key)" → key
        const m = label.match(/^Event\s+\d+\s+Data\s+\(([^)]+)\)$/i);
        if (m) { return m[1]; }
        // Match generic "Something (key)" patterns where the parens contain
        // something meaningful (not just provider info)
        const m2 = label.match(/^[A-Z][a-z]+\s+\d+\s+Data\s+\(([^)]+)\)$/);
        if (m2) { return m2[1]; }
        return label;
    }

    /**
     * Build a compact button that summarizes the dataLayer-vs-hit match and
     * opens a full slide-out panel when clicked. Returns null if no triggering
     * dataLayer push is correlated.
     */
    function buildDataLayerMatchButton(hit) {
        if (!hit.triggeredBy) { return null; }
        const dl = state.items.find((x) => x.id === hit.triggeredBy);
        if (!dl || dl.kind !== "dl") { return null; }

        // Compute counts upfront so the button shows a useful preview
        const summary = computeDataLayerMatch(hit, dl);

        const btn = document.createElement("button");
        btn.className = "dl-match-button";
        btn.title = "Compare this hit with its triggering dataLayer push";

        // Left side: icon + label stacked
        const left = document.createElement("span");
        left.className = "dl-match-button-left";
        left.innerHTML =
            '<span class="dl-match-button-icon">⇄</span>' +
            '<span class="dl-match-button-textgroup">' +
                '<span class="dl-match-button-label">Compare with dataLayer</span>' +
                '<span class="dl-match-button-sub">push: "' + escapeHtml(dl.eventName || "(unnamed)") + '"</span>' +
            '</span>';
        btn.appendChild(left);

        // Right side: count pills with status icons
        const counts = document.createElement("span");
        counts.className = "dl-match-button-counts";
        counts.innerHTML =
            '<span class="dl-pill match" title="' + summary.counts.match + ' matching values">' +
                '<span class="dl-pill-icon">✓</span>' + summary.counts.match +
            '</span>' +
            '<span class="dl-pill diff" title="' + summary.counts.diff + ' different values">' +
                '<span class="dl-pill-icon">≠</span>' + summary.counts.diff +
            '</span>' +
            '<span class="dl-pill only-dl" title="' + summary.counts["only-dl"] + ' only in dataLayer">' +
                '<span class="dl-pill-icon">←</span>' + summary.counts["only-dl"] +
            '</span>' +
            '<span class="dl-pill only-hit" title="' + summary.counts["only-hit"] + ' only in hit">' +
                '<span class="dl-pill-icon">→</span>' + summary.counts["only-hit"] +
            '</span>';
        btn.appendChild(counts);

        // Chevron indicating it opens a panel
        const chev = document.createElement("span");
        chev.className = "dl-match-button-chevron";
        chev.textContent = "›";
        btn.appendChild(chev);

        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            openDataLayerMatchPanel(hit, dl, summary);
        });

        return btn;
    }

    /**
     * Tiny HTML escaper for inserting user content into innerHTML strings safely.
     */
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /**
     * Compute the row-by-row match between a hit and its triggering dataLayer push.
     * Returns { rows: [...], counts: {...} } reusable in either inline or panel views.
     */
    function computeDataLayerMatch(hit, dl) {
        const dlFlat = flattenDataLayer(dl.payload);

        const hitFlat = {};
        hit.data.forEach((p) => {
            if (!p || p.key == null) { return; }
            let key = String(p.key);
            const stripPrefix = key.match(/^(?:ep|epn)(?:\[\d+])?\.(.+)$/);
            if (stripPrefix) {
                key = stripPrefix[1];
                hitFlat[key] = String(p.value == null ? "" : p.value);
            } else if (key === "en" || /^en\[\d+]$/.test(key)) {
                hitFlat["__event"] = String(p.value || "");
            }
        });

        const dlEventName = dl.eventName || "";
        if (dlEventName) { dlFlat["__event"] = dlEventName; }

        const allKeys = new Set([...Object.keys(dlFlat), ...Object.keys(hitFlat)]);
        const sortedKeys = Array.from(allKeys).sort((a, b) => {
            if (a === "__event") { return -1; }
            if (b === "__event") { return 1; }
            return a.localeCompare(b);
        });

        const rows = [];
        const counts = { match: 0, diff: 0, "only-dl": 0, "only-hit": 0 };
        sortedKeys.forEach((k) => {
            const inDl = Object.prototype.hasOwnProperty.call(dlFlat, k);
            const inHit = Object.prototype.hasOwnProperty.call(hitFlat, k);
            const dlVal = inDl ? dlFlat[k] : null;
            const hitVal = inHit ? hitFlat[k] : null;
            let status;
            if (inDl && inHit) {
                const a = decodeSafe(String(dlVal));
                const b = decodeSafe(String(hitVal));
                status = (a === b) ? "match" : "diff";
            } else if (inDl) { status = "only-dl"; }
            else { status = "only-hit"; }
            counts[status]++;
            rows.push({ key: k, dlVal, hitVal, status });
        });

        return { rows, counts };
    }

    /**
     * Open the slide-out panel showing the full hit-vs-dataLayer comparison.
     */
    function openDataLayerMatchPanel(hit, dl, summary) {
        // Backdrop
        const backdrop = document.createElement("div");
        backdrop.className = "dl-panel-backdrop";

        // Panel
        const panel = document.createElement("div");
        panel.className = "dl-panel";

        // Header
        const header = document.createElement("div");
        header.className = "dl-panel-header";
        header.innerHTML =
            '<div class="dl-panel-title-block">' +
                '<div class="dl-panel-title">DataLayer Match</div>' +
                '<div class="dl-panel-subtitle">' +
                    'Hit "<strong>' + escapeHtml(hit.requestType) + '</strong>" ' +
                    '↔ push "<strong>' + escapeHtml(dl.eventName || "(unnamed)") + '</strong>"' +
                '</div>' +
            '</div>' +
            '<button class="dl-panel-close" aria-label="Close">×</button>';
        panel.appendChild(header);

        // Counts
        const cntBar = document.createElement("div");
        cntBar.className = "dl-panel-counts";
        cntBar.innerHTML =
            '<span class="dl-count match">' + summary.counts.match + ' match</span>' +
            '<span class="dl-count diff">' + summary.counts.diff + ' diff</span>' +
            '<span class="dl-count only-dl">' + summary.counts["only-dl"] + ' only DL</span>' +
            '<span class="dl-count only-hit">' + summary.counts["only-hit"] + ' only hit</span>';
        panel.appendChild(cntBar);

        // Grid
        const grid = document.createElement("div");
        grid.className = "dl-match-grid";

        const h1 = document.createElement("div"); h1.className = "dl-match-th"; h1.textContent = "Key";
        const h2 = document.createElement("div"); h2.className = "dl-match-th"; h2.textContent = "DataLayer";
        const h3 = document.createElement("div"); h3.className = "dl-match-th"; h3.textContent = "Hit";
        grid.appendChild(h1); grid.appendChild(h2); grid.appendChild(h3);

        summary.rows.forEach((r) => {
            const keyEl = document.createElement("div");
            keyEl.className = "dl-match-key";
            keyEl.textContent = r.key === "__event" ? "(event name)" : r.key;

            const dlEl = document.createElement("div");
            dlEl.className = "dl-match-cell dl-cell status-" + r.status;
            if (r.dlVal == null) {
                dlEl.textContent = "—";
                dlEl.classList.add("missing");
            } else {
                dlEl.textContent = String(r.dlVal);
            }

            const hitEl = document.createElement("div");
            hitEl.className = "dl-match-cell hit-cell status-" + r.status;
            if (r.hitVal == null) {
                hitEl.textContent = "—";
                hitEl.classList.add("missing");
            } else {
                hitEl.textContent = decodeSafe(String(r.hitVal));
            }

            grid.appendChild(keyEl);
            grid.appendChild(dlEl);
            grid.appendChild(hitEl);
        });

        const gridWrap = document.createElement("div");
        gridWrap.className = "dl-panel-body";
        gridWrap.appendChild(grid);
        panel.appendChild(gridWrap);

        // Mount
        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
        // Trigger slide-in via class on next frame
        requestAnimationFrame(() => {
            backdrop.classList.add("visible");
            panel.classList.add("visible");
        });

        const close = () => {
            backdrop.classList.remove("visible");
            panel.classList.remove("visible");
            setTimeout(() => {
                if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
                if (panel.parentNode) { panel.parentNode.removeChild(panel); }
                document.removeEventListener("keydown", onEsc);
            }, 250);
        };
        const onEsc = (ev) => { if (ev.key === "Escape") { close(); } };

        backdrop.addEventListener("click", close);
        header.querySelector(".dl-panel-close").addEventListener("click", close);
        document.addEventListener("keydown", onEsc);
    }

    function escapeHtml(s) {
        if (s == null) { return ""; }
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /**
     * Build a "DataLayer Match" section that compares this hit's event-level
     * parameters with the dataLayer push that likely triggered it.
     *
     * Status colors per parameter:
     *   match    : hit value === dataLayer value (or both compared after URL-decode)
     *   diff     : present in both but values differ (transformed by GTM)
     *   only-dl  : in dataLayer but not in hit (didn't make it to GA4)
     *   only-hit : in hit but not in dataLayer (added/computed by GTM)
     *
     * Returns null if no triggering dataLayer push is found.
     * Kept for reference / potential future inline use.
     */
    function buildDataLayerMatchSection(hit) {
        if (!hit.triggeredBy) { return null; }
        const dl = state.items.find((x) => x.id === hit.triggeredBy);
        if (!dl || dl.kind !== "dl") { return null; }

        // Flatten dataLayer payload to a key/value map (supports nested objects).
        const dlFlat = flattenDataLayer(dl.payload);

        // Extract event-level keys from hit (ep.* / epn.* / event_*).
        const hitFlat = {};
        hit.data.forEach((p) => {
            if (!p || p.key == null) { return; }
            // Strip the ep. / epn. prefix and array index for comparison.
            // Examples:
            //   "ep.event_category" -> "event_category"
            //   "epn.form_step_number" -> "form_step_number"
            //   "ep[0].event_category" -> "event_category"  (batched format)
            //   "ep[0].cta_clicked" -> "cta_clicked"
            let key = String(p.key);
            const stripPrefix = key.match(/^(?:ep|epn)(?:\[\d+])?\.(.+)$/);
            if (stripPrefix) {
                key = stripPrefix[1];
                hitFlat[key] = String(p.value == null ? "" : p.value);
            } else if (key === "en" || /^en\[\d+]$/.test(key)) {
                // Map the event name itself
                hitFlat["__event"] = String(p.value || "");
            }
        });

        // Try to also align dataLayer top-level event name with hit's en
        const dlEventName = dl.eventName || "";
        if (dlEventName) { dlFlat["__event"] = dlEventName; }

        // Build comparison rows
        const rows = [];
        const allKeys = new Set([...Object.keys(dlFlat), ...Object.keys(hitFlat)]);

        // Sort: __event first, then alphabetical
        const sortedKeys = Array.from(allKeys).sort((a, b) => {
            if (a === "__event") { return -1; }
            if (b === "__event") { return 1; }
            return a.localeCompare(b);
        });

        sortedKeys.forEach((k) => {
            const inDl = Object.prototype.hasOwnProperty.call(dlFlat, k);
            const inHit = Object.prototype.hasOwnProperty.call(hitFlat, k);
            const dlVal = inDl ? dlFlat[k] : null;
            const hitVal = inHit ? hitFlat[k] : null;
            let status;
            if (inDl && inHit) {
                // Compare values (decoded both sides)
                const a = decodeSafe(String(dlVal));
                const b = decodeSafe(String(hitVal));
                status = (a === b) ? "match" : "diff";
            } else if (inDl) { status = "only-dl"; }
            else { status = "only-hit"; }
            rows.push({ key: k, dlVal, hitVal, status });
        });

        // Counts for the section header
        const counts = { match: 0, diff: 0, "only-dl": 0, "only-hit": 0 };
        rows.forEach((r) => { counts[r.status]++; });

        // Build the section DOM
        const section = document.createElement("div");
        section.className = "dl-match-section";

        const heading = document.createElement("div");
        heading.className = "dl-match-heading";
        heading.innerHTML =
            '<span class="dl-match-title">DataLayer Match</span>' +
            '<span class="dl-match-counts">' +
                '<span class="dl-count match">' + counts.match + ' match</span>' +
                '<span class="dl-count diff">' + counts.diff + ' diff</span>' +
                '<span class="dl-count only-dl">' + counts["only-dl"] + ' only DL</span>' +
                '<span class="dl-count only-hit">' + counts["only-hit"] + ' only hit</span>' +
            '</span>';
        section.appendChild(heading);

        const subtitle = document.createElement("div");
        subtitle.className = "dl-match-subtitle";
        subtitle.textContent = 'Triggered by dataLayer push: "' + (dl.eventName || "(unnamed)") + '"';
        section.appendChild(subtitle);

        // Table-like grid: key | dataLayer value | hit value | status
        const grid = document.createElement("div");
        grid.className = "dl-match-grid";

        // Header row
        const h1 = document.createElement("div"); h1.className = "dl-match-th"; h1.textContent = "Key";
        const h2 = document.createElement("div"); h2.className = "dl-match-th"; h2.textContent = "DataLayer";
        const h3 = document.createElement("div"); h3.className = "dl-match-th"; h3.textContent = "Hit";
        grid.appendChild(h1); grid.appendChild(h2); grid.appendChild(h3);

        rows.forEach((r) => {
            const keyEl = document.createElement("div");
            keyEl.className = "dl-match-key";
            keyEl.textContent = r.key === "__event" ? "(event name)" : r.key;

            const dlEl = document.createElement("div");
            dlEl.className = "dl-match-cell dl-cell status-" + r.status;
            if (r.dlVal == null) {
                dlEl.textContent = "—";
                dlEl.classList.add("missing");
            } else {
                dlEl.textContent = String(r.dlVal);
            }

            const hitEl = document.createElement("div");
            hitEl.className = "dl-match-cell hit-cell status-" + r.status;
            if (r.hitVal == null) {
                hitEl.textContent = "—";
                hitEl.classList.add("missing");
            } else {
                hitEl.textContent = decodeSafe(String(r.hitVal));
            }

            grid.appendChild(keyEl);
            grid.appendChild(dlEl);
            grid.appendChild(hitEl);
        });

        section.appendChild(grid);
        return section;
    }

    /**
     * Recursively flatten a dataLayer payload into a flat key->string map.
     * Nested keys are joined with "." (e.g. ecommerce.value).
     * Arrays of objects: only first 3 items are flattened with [N] suffix.
     */
    function flattenDataLayer(obj, prefix = "") {
        const out = {};
        if (obj == null || typeof obj !== "object") {
            if (prefix) { out[prefix] = String(obj); }
            return out;
        }
        if (Array.isArray(obj)) {
            obj.slice(0, 3).forEach((v, i) => {
                Object.assign(out, flattenDataLayer(v, prefix + "[" + i + "]"));
            });
            return out;
        }
        Object.keys(obj).forEach((k) => {
            const path = prefix ? (prefix + "." + k) : k;
            const v = obj[k];
            if (v != null && typeof v === "object") {
                Object.assign(out, flattenDataLayer(v, path));
            } else {
                out[path] = v == null ? "" : String(v);
            }
        });
        return out;
    }

    /**
     * Try to URL-decode a string. If it fails (already decoded or invalid), returns as-is.
     */
    function decodeSafe(s) {
        try { return decodeURIComponent(s); } catch (e) { return s; }
    }

    /**
     * Build a prominent "Context" section for a hit, highlighting the most
     * meaningful fields (event_category, event_action, event_label, cta, etc.)
     * Returns null if no context fields are found.
     */
    function buildHitContextSection(hit) {
        // Build a map of params by key for fast lookup
        const byKey = {};
        hit.data.forEach((p) => {
            if (p && p.key != null) { byKey[p.key] = p; }
        });

        // Ordered list of "context" keys we care about. Same idea supports ep.* / epn.*
        // (custom event parameters in GA4) and their aliases. Displayed in this order.
        const contextKeys = [
            { key: "ep.event_category", label: "Category" },
            { key: "ep.event_action",   label: "Action" },
            { key: "ep.event_label",    label: "Label" },
            { key: "ep.event_name",     label: "Event name" },
            { key: "ep.cta_clicked",    label: "CTA" },
            { key: "ep.click_type",     label: "Click type" },
            { key: "ep.area",           label: "Area" },
            { key: "ep.element_text",   label: "Element text" },
            { key: "ep.element_classes",label: "Element classes" },
            { key: "ep.page_type",      label: "Page type" },
            { key: "ep.page_template",  label: "Template" },
            { key: "ep.page_category_level1", label: "Page category" },
            { key: "ep.form_name",      label: "Form" },
            { key: "epn.form_step_number", label: "Form step" },
            { key: "ep.search_term",    label: "Search term" },
            // Non-GA4 providers — common conventions
            { key: "eventCategory", label: "Category" },
            { key: "eventAction",   label: "Action" },
            { key: "eventLabel",    label: "Label" }
        ];

        const rows = [];
        contextKeys.forEach((def) => {
            if (byKey[def.key] != null && byKey[def.key].value !== "" && byKey[def.key].value != null) {
                rows.push({ label: def.label, value: byKey[def.key].value });
            }
        });

        if (rows.length === 0) { return null; }

        const section = document.createElement("div");
        section.className = "context-section";

        const heading = document.createElement("div");
        heading.className = "context-heading";
        heading.textContent = "Context";
        section.appendChild(heading);

        const grid = document.createElement("div");
        grid.className = "context-grid";
        rows.forEach((r) => {
            const k = document.createElement("div");
            k.className = "context-key";
            k.textContent = r.label;
            const v = document.createElement("div");
            v.className = "context-value";
            v.textContent = String(r.value);
            grid.appendChild(k);
            grid.appendChild(v);
        });
        section.appendChild(grid);
        return section;
    }

    function renderDlItem(ev) {
        const li = document.createElement("li");
        li.className = "item dl";
        li.dataset.id = String(ev.id);
        if (state.expanded.has(ev.id)) { li.classList.add("expanded"); }

        // Super minimal title — just the event name, no preview
        // (matches datalayer checker style exactly)
        li.appendChild(buildSummary(ev, {
            fallbackLetter: "DL",
            kindLabel: "",              // no right-side tag for dl (kept clean)
            eventLabel: ev.eventName || "(dataLayer push)",
            subtitle: ""
        }));

        if (state.expanded.has(ev.id)) {
            li.appendChild(renderDlDetails(ev));
        }

        return li;
    }

    function renderDlDetails(ev) {
        const wrap = document.createElement("div");
        wrap.className = "item-details";

        // Correlation pills: which hits were triggered after this push
        if (ev.triggeredHits.length > 0) {
            const corr = document.createElement("div");
            corr.className = "correlation";

            const hitsByProvider = {};
            ev.triggeredHits.forEach((hitId) => {
                const h = state.items.find((x) => x.id === hitId);
                if (h) {
                    if (!hitsByProvider[h.providerName]) { hitsByProvider[h.providerName] = []; }
                    hitsByProvider[h.providerName].push(h);
                }
            });

            const providerNames = Object.keys(hitsByProvider);
            providerNames.slice(0, 5).forEach((name) => {
                const hits = hitsByProvider[name];
                const first = hits[0];
                const label = "→ " + name + (hits.length > 1 ? " × " + hits.length : "");
                corr.appendChild(buildPill("to-hit", label, first.id));
            });
            if (providerNames.length > 5) {
                const extra = document.createElement("span");
                extra.className = "corr-pill";
                extra.textContent = "+" + (providerNames.length - 5);
                corr.appendChild(extra);
            }
            wrap.appendChild(corr);
        }

        const meta = document.createElement("div");
        meta.className = "item-meta-line";
        meta.textContent = ev.layer + " · " + (ev.origin === "initial" ? "pre-existing" : "push()") + " · " + new Date(ev.timestamp).toLocaleTimeString();
        wrap.appendChild(meta);

        // Actions bar: Pretty/Raw toggle + Copy buttons
        const viewMode = state.dlViewMode[ev.id] || "pretty";
        const actionsBar = document.createElement("div");
        actionsBar.className = "actions-bar";

        const toggle = document.createElement("div");
        toggle.className = "view-toggle";

        const btnPretty = document.createElement("button");
        btnPretty.className = "view-btn" + (viewMode === "pretty" ? " active" : "");
        btnPretty.textContent = "Formatted";
        btnPretty.addEventListener("click", (e) => {
            e.stopPropagation();
            state.dlViewMode[ev.id] = "pretty";
            render();
        });
        toggle.appendChild(btnPretty);

        const btnRaw = document.createElement("button");
        btnRaw.className = "view-btn" + (viewMode === "raw" ? " active" : "");
        btnRaw.textContent = "Raw JSON";
        btnRaw.addEventListener("click", (e) => {
            e.stopPropagation();
            state.dlViewMode[ev.id] = "raw";
            render();
        });
        toggle.appendChild(btnRaw);

        actionsBar.appendChild(toggle);

        // Copy buttons group
        const copyGroup = document.createElement("div");
        copyGroup.className = "copy-group";
        copyGroup.appendChild(buildCopyButton("JSON", () => JSON.stringify(ev.payload, null, 2)));
        copyGroup.appendChild(buildCopyButton("Push", () => buildDlPushSnippet(ev)));
        actionsBar.appendChild(copyGroup);

        wrap.appendChild(actionsBar);

        if (viewMode === "raw") {
            const json = document.createElement("pre");
            json.className = "json-view";
            json.innerHTML = renderJsonHtml(ev.payload, 0);
            wrap.appendChild(json);
        } else {
            wrap.appendChild(renderDlPretty(ev.payload));
        }

        return wrap;
    }

    /**
     * "Pretty" formatted view of a dataLayer payload.
     * Groups known categories (Event, Ecommerce/Items, User, Page, Other) into
     * readable sections, with a table for commerce items.
     */
    function renderDlPretty(payload) {
        const wrap = document.createElement("div");
        wrap.className = "dl-pretty";

        if (!payload || typeof payload !== "object") {
            const div = document.createElement("div");
            div.className = "param-value empty";
            div.textContent = String(payload);
            wrap.appendChild(div);
            return wrap;
        }

        // --- Event name callout (if present) ---
        const eventName = extractEventName(payload);
        if (eventName) {
            const hero = document.createElement("div");
            hero.className = "dl-hero";
            const label = document.createElement("span");
            label.className = "dl-hero-label";
            label.textContent = "Event";
            const value = document.createElement("span");
            value.className = "dl-hero-value";
            value.textContent = eventName;
            hero.appendChild(label);
            hero.appendChild(value);
            wrap.appendChild(hero);
        }

        // --- Categorize top-level keys ---
        const categorized = categorizePayload(payload);

        // Render Ecommerce section (if any)
        if (categorized.ecommerce) {
            wrap.appendChild(renderEcommerceSection(categorized.ecommerce));
        }

        // Render User section
        if (Object.keys(categorized.user).length > 0) {
            wrap.appendChild(renderDlSection("User", categorized.user));
        }

        // Render Page section
        if (Object.keys(categorized.page).length > 0) {
            wrap.appendChild(renderDlSection("Page", categorized.page));
        }

        // Render Event properties section
        if (Object.keys(categorized.eventProps).length > 0) {
            wrap.appendChild(renderDlSection("Event Properties", categorized.eventProps));
        }

        // Other fallback
        if (Object.keys(categorized.other).length > 0) {
            wrap.appendChild(renderDlSection("Other", categorized.other));
        }

        // Nothing categorized? Show raw
        if (!categorized.ecommerce &&
            Object.keys(categorized.user).length === 0 &&
            Object.keys(categorized.page).length === 0 &&
            Object.keys(categorized.eventProps).length === 0 &&
            Object.keys(categorized.other).length === 0 &&
            !eventName) {
            const empty = document.createElement("div");
            empty.className = "param-value empty";
            empty.textContent = "(empty payload)";
            wrap.appendChild(empty);
        }

        return wrap;
    }

    /**
     * Split a payload's top-level keys into semantic buckets.
     */
    function categorizePayload(payload) {
        const result = { ecommerce: null, user: {}, page: {}, eventProps: {}, other: {} };

        // Ecommerce detection — GTM style `ecommerce: {...}` or top-level `items: [...]`
        if (payload.ecommerce && typeof payload.ecommerce === "object") {
            result.ecommerce = payload.ecommerce;
        } else if (Array.isArray(payload.items) && payload.items.length > 0 && typeof payload.items[0] === "object") {
            result.ecommerce = { items: payload.items };
        }

        const userPrefixes = ["user_", "customer_"];
        const userKeys = ["user", "userId", "user_id", "email", "customerId", "customer_id", "loginStatus", "hashed_email"];
        const pagePrefixes = ["page_"];
        const pageKeys = ["page", "pageName", "pageType", "pageCategory", "url", "referrer", "pageTitle", "page_title", "page_location", "page_referrer"];
        const skipKeys = ["event", "ecommerce", "items", "gtm.uniqueEventId", "gtm.start"];

        Object.keys(payload).forEach((key) => {
            if (skipKeys.indexOf(key) !== -1) { return; }
            const val = payload[key];

            // User
            if (userKeys.indexOf(key) !== -1 || userPrefixes.some((p) => key.indexOf(p) === 0)) {
                result.user[key] = val; return;
            }
            // Page
            if (pageKeys.indexOf(key) !== -1 || pagePrefixes.some((p) => key.indexOf(p) === 0)) {
                result.page[key] = val; return;
            }
            // Event properties: `event_*`, or scalar fields typically
            if (key.indexOf("event_") === 0 || (typeof val !== "object" && val !== null)) {
                result.eventProps[key] = val; return;
            }
            // Everything else → other (likely nested objects)
            result.other[key] = val;
        });

        return result;
    }

    /**
     * Render a section with a title and a list of key/value pairs.
     * Object/array values get a collapsible nested JSON.
     */
    function renderDlSection(title, obj) {
        const section = document.createElement("div");
        section.className = "dl-section";

        const heading = document.createElement("div");
        heading.className = "dl-section-title";
        heading.textContent = title;
        section.appendChild(heading);

        const grid = document.createElement("div");
        grid.className = "params";

        Object.keys(obj).forEach((key) => {
            const val = obj[key];
            const keyEl = document.createElement("div");
            keyEl.className = "param-key";
            keyEl.textContent = key;

            const valEl = document.createElement("div");
            valEl.className = "param-value";

            if (val === null || val === undefined) {
                valEl.classList.add("empty");
                valEl.textContent = val === null ? "(null)" : "(undefined)";
            } else if (typeof val === "object") {
                // Nested object: inline compact JSON
                const pre = document.createElement("pre");
                pre.className = "json-view json-inline";
                pre.innerHTML = renderJsonHtml(val, 0);
                valEl.appendChild(pre);
            } else {
                valEl.textContent = String(val);
            }

            grid.appendChild(keyEl);
            grid.appendChild(valEl);
        });

        section.appendChild(grid);
        return section;
    }

    /**
     * Render an ecommerce section with items in a readable format.
     */
    function renderEcommerceSection(ecom) {
        const section = document.createElement("div");
        section.className = "dl-section";

        const heading = document.createElement("div");
        heading.className = "dl-section-title";
        heading.textContent = "Ecommerce";
        section.appendChild(heading);

        // Top-level ecommerce fields (currency, value, transaction_id, etc.)
        const topLevelFields = {};
        Object.keys(ecom).forEach((k) => {
            if (k !== "items" && k !== "products" && typeof ecom[k] !== "object") {
                topLevelFields[k] = ecom[k];
            }
        });
        if (Object.keys(topLevelFields).length > 0) {
            const grid = document.createElement("div");
            grid.className = "params";
            Object.keys(topLevelFields).forEach((k) => {
                const keyEl = document.createElement("div");
                keyEl.className = "param-key";
                keyEl.textContent = k;
                const valEl = document.createElement("div");
                valEl.className = "param-value";
                valEl.textContent = String(topLevelFields[k]);
                grid.appendChild(keyEl);
                grid.appendChild(valEl);
            });
            section.appendChild(grid);
        }

        // Items (or products for GA Universal style)
        const items = Array.isArray(ecom.items) ? ecom.items : (Array.isArray(ecom.products) ? ecom.products : null);
        if (items && items.length > 0) {
            const itemsLabel = document.createElement("div");
            itemsLabel.className = "dl-items-label";
            itemsLabel.textContent = "Items (" + items.length + ")";
            section.appendChild(itemsLabel);

            items.forEach((item, idx) => {
                const card = document.createElement("div");
                card.className = "dl-item-card";

                const cardHeader = document.createElement("div");
                cardHeader.className = "dl-item-header";
                const itemName = item.item_name || item.name || item.title || ("Item #" + (idx + 1));
                cardHeader.textContent = itemName;
                card.appendChild(cardHeader);

                // Inline fields for the item
                const grid = document.createElement("div");
                grid.className = "params";
                Object.keys(item).forEach((key) => {
                    if (key === "item_name" || key === "name" || key === "title") { return; }
                    const val = item[key];
                    const keyEl = document.createElement("div");
                    keyEl.className = "param-key";
                    keyEl.textContent = key;
                    const valEl = document.createElement("div");
                    valEl.className = "param-value";
                    if (val === null || val === undefined) {
                        valEl.classList.add("empty");
                        valEl.textContent = val === null ? "(null)" : "(undefined)";
                    } else if (typeof val === "object") {
                        const pre = document.createElement("pre");
                        pre.className = "json-view json-inline";
                        pre.innerHTML = renderJsonHtml(val, 0);
                        valEl.appendChild(pre);
                    } else {
                        valEl.textContent = String(val);
                    }
                    grid.appendChild(keyEl);
                    grid.appendChild(valEl);
                });
                card.appendChild(grid);
                section.appendChild(card);
            });
        }

        return section;
    }

    /**
     * Render a JS value as colorized HTML with indentation.
     * Depth-first, handles arrays, objects, primitives.
     */
    function renderJsonHtml(value, depth) {
        const pad = "  ".repeat(depth);
        const padNext = "  ".repeat(depth + 1);
        if (value === null) { return '<span class="json-null">null</span>'; }
        if (value === undefined) { return '<span class="json-null">undefined</span>'; }
        if (typeof value === "boolean") { return '<span class="json-boolean">' + value + '</span>'; }
        if (typeof value === "number") { return '<span class="json-number">' + value + '</span>'; }
        if (typeof value === "string") { return '<span class="json-string">"' + escapeHtml(value) + '"</span>'; }

        if (Array.isArray(value)) {
            if (value.length === 0) { return "[]"; }
            let out = "[\n";
            for (let i = 0; i < value.length; i++) {
                out += padNext + renderJsonHtml(value[i], depth + 1);
                if (i < value.length - 1) { out += ","; }
                out += "\n";
            }
            out += pad + "]";
            return out;
        }

        if (typeof value === "object") {
            const keys = Object.keys(value);
            if (keys.length === 0) { return "{}"; }
            let out = "{\n";
            keys.forEach((k, idx) => {
                out += padNext + '<span class="json-key">"' + escapeHtml(k) + '"</span>: ' + renderJsonHtml(value[k], depth + 1);
                if (idx < keys.length - 1) { out += ","; }
                out += "\n";
            });
            out += pad + "}";
            return out;
        }

        return escapeHtml(String(value));
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /* ----------- Shared summary builder ----------- */

    function buildSummary(item, opts) {
        const summary = document.createElement("div");
        summary.className = "item-summary";

        // Colored numbered badge (like datalayer checker style)
        const badge = document.createElement("span");
        badge.className = "seq-badge cat-" + (item.category || "custom");
        badge.textContent = String(item.seq);
        summary.appendChild(badge);

        // Title — just the event/request name, clean and simple
        const title = document.createElement("span");
        title.className = "item-title";
        title.textContent = opts.eventLabel || opts.kindLabel || "(event)";
        summary.appendChild(title);

        // Tiny right-aligned label: provider name for hits, layer name for dataLayer
        // Kept compact and low-emphasis to not clutter the list
        if (opts.kindLabel && opts.eventLabel && opts.kindLabel !== opts.eventLabel) {
            const tag = document.createElement("span");
            tag.className = "item-tag";
            tag.textContent = opts.kindLabel;
            summary.appendChild(tag);
        }

        // GTM container ID badge (only for hits sent through a GTM container)
        if (opts.containerId) {
            const ctn = document.createElement("span");
            ctn.className = "item-container-tag";
            ctn.textContent = opts.containerId;
            ctn.title = "GTM Container: " + opts.containerId;
            summary.appendChild(ctn);
        }

        summary.addEventListener("click", () => toggleExpanded(item.id));

        return summary;
    }

    /* ----------- Correlation pill ----------- */

    function buildPill(cls, label, targetItemId) {
        const pill = document.createElement("a");
        pill.className = "corr-pill " + cls;
        pill.href = "#";

        const text = document.createElement("span");
        text.className = "corr-label";
        text.textContent = label;
        pill.appendChild(text);

        pill.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            scrollToItem(targetItemId);
        });

        return pill;
    }

    function scrollToItem(itemId) {
        // Make sure filter/mode don't hide the target
        const target = state.items.find((x) => x.id === itemId);
        if (!target) { return; }

        if (state.mode !== "all") {
            if (target.kind === "hit" && state.mode !== "hits") { setMode("all"); }
            else if (target.kind === "dl" && state.mode !== "datalayer") { setMode("all"); }
        }

        // Expand it so context is obvious
        state.expanded.add(itemId);
        render();

        // Scroll and highlight on the next frame (after render)
        requestAnimationFrame(() => {
            const node = el.list.querySelector('li[data-id="' + itemId + '"]');
            if (node) {
                node.scrollIntoView({ behavior: "smooth", block: "center" });
                node.classList.add("highlighted");
                setTimeout(() => node.classList.remove("highlighted"), 1500);
            }
        });
    }

    function toggleExpanded(id) {
        if (state.expanded.has(id)) { state.expanded.delete(id); }
        else { state.expanded.add(id); }
        render();
    }

    /* ---------------------------------------------------------------
     * Provider filter dropdown — auto-populates with detected providers
     * --------------------------------------------------------------- */
    function loadProviderFilterPreference() {
        try {
            const saved = localStorage.getItem("omnibug_provider_filter");
            if (saved) { state.providerFilter = saved; }
        } catch (e) { /* ignore */ }
    }

    function loadNoisePreference() {
        try {
            const saved = localStorage.getItem("omnibug_show_noise");
            state.showNoise = saved === "1";
        } catch (e) { /* ignore */ }
    }

    function saveProviderFilterPreference() {
        try { localStorage.setItem("omnibug_provider_filter", state.providerFilter); }
        catch (e) { /* ignore */ }
    }

    function updateProviderFilterDropdown() {
        // Show/hide the bar based on mode
        const visible = state.mode === "hits";
        el.providerFilterBar.classList.toggle("hidden", !visible);
        if (!visible) { return; }

        // Collect unique providers from current hits
        const seen = new Map(); // key -> name
        state.items.forEach((it) => {
            if (it.kind === "hit" && it.providerKey && !seen.has(it.providerKey)) {
                seen.set(it.providerKey, it.providerName || it.providerKey);
            }
        });

        // Sort: GA4 always first if present, then alphabetical by display name
        const GA4_KEY = "GOOGLEANALYTICS4";
        const sorted = Array.from(seen.entries()).sort((a, b) => {
            if (a[0] === GA4_KEY) { return -1; }
            if (b[0] === GA4_KEY) { return 1; }
            return String(a[1]).localeCompare(String(b[1]));
        });

        // Rebuild only if contents changed (avoids losing selection on every hit)
        const currentOptions = Array.from(el.providerSelect.options).map((o) => o.value).join("|");
        const newOptions = ["all"].concat(sorted.map((p) => p[0])).join("|");
        if (currentOptions === newOptions) {
            // Same options, but counts may have changed — refresh labels
            const totalHits = state.items.filter((it) => it.kind === "hit").length;
            el.providerSelect.options[0].textContent = "All providers (" + totalHits + ")";
            sorted.forEach(([key, name], idx) => {
                const opt = el.providerSelect.options[idx + 1];
                if (opt) {
                    const count = state.items.filter((it) => it.kind === "hit" && it.providerKey === key).length;
                    opt.textContent = name + " (" + count + ")";
                }
            });
            return;
        }

        const previousValue = state.providerFilter;
        el.providerSelect.innerHTML = "";

        const totalHits = state.items.filter((it) => it.kind === "hit").length;
        const allOpt = document.createElement("option");
        allOpt.value = "all";
        allOpt.textContent = "All providers (" + totalHits + ")";
        el.providerSelect.appendChild(allOpt);

        sorted.forEach(([key, name]) => {
            const opt = document.createElement("option");
            opt.value = key;
            const count = state.items.filter((it) => it.kind === "hit" && it.providerKey === key).length;
            opt.textContent = name + " (" + count + ")";
            el.providerSelect.appendChild(opt);
        });

        // Restore selection priority:
        // 1. Saved preference if still valid (provider still detected)
        // 2. GA4 if detected
        // 3. "all" otherwise
        if (previousValue && previousValue !== "all" && seen.has(previousValue)) {
            el.providerSelect.value = previousValue;
        } else if (seen.has(GA4_KEY) && (previousValue === "all" || !previousValue)) {
            // Auto-prefer GA4 on first appearance, but only if user hasn't chosen "all" explicitly.
            // We use a sentinel localStorage value to distinguish "never set" from "explicitly all".
            const userChose = (function () {
                try { return localStorage.getItem("omnibug_provider_filter_user_set") === "1"; }
                catch (e) { return false; }
            })();
            if (!userChose) {
                state.providerFilter = GA4_KEY;
                el.providerSelect.value = GA4_KEY;
            } else {
                state.providerFilter = "all";
                el.providerSelect.value = "all";
            }
        } else {
            state.providerFilter = "all";
            el.providerSelect.value = "all";
        }
    }

    /**
     * Update the container ID dropdown with the GTM containers detected in the
     * current hits. Only visible in Hits mode.
     */
    function updateContainerFilterDropdown() {
        if (!el.containerSelect) { return; }

        // Collect unique containers from current hits (filtered by current provider if any)
        const seen = new Set();
        state.items.forEach((it) => {
            if (it.kind === "hit" && it.containerId) {
                // Only count containers visible after applying the provider filter
                if (state.providerFilter === "all" || it.providerKey === state.providerFilter) {
                    seen.add(it.containerId);
                }
            }
        });

        const sorted = Array.from(seen).sort();

        // Build option list
        const currentOptions = Array.from(el.containerSelect.options).map((o) => o.value).join("|");
        const newOptions = ["all"].concat(sorted).join("|");
        if (currentOptions === newOptions) { return; }

        const previousValue = state.containerFilter;
        el.containerSelect.innerHTML = "";

        // Count totals across visible providers
        const totalWithContainer = state.items.filter((it) => {
            if (it.kind !== "hit" || !it.containerId) { return false; }
            return state.providerFilter === "all" || it.providerKey === state.providerFilter;
        }).length;

        const allOpt = document.createElement("option");
        allOpt.value = "all";
        allOpt.textContent = sorted.length === 0
            ? "—"
            : "All (" + totalWithContainer + ")";
        el.containerSelect.appendChild(allOpt);

        sorted.forEach((cid) => {
            const opt = document.createElement("option");
            opt.value = cid;
            const count = state.items.filter((it) =>
                it.kind === "hit" && it.containerId === cid &&
                (state.providerFilter === "all" || it.providerKey === state.providerFilter)
            ).length;
            opt.textContent = cid + " (" + count + ")";
            el.containerSelect.appendChild(opt);
        });

        // Disable when no containers detected
        el.containerSelect.disabled = sorted.length === 0;

        // Restore selection if still valid
        if (previousValue !== "all" && seen.has(previousValue)) {
            el.containerSelect.value = previousValue;
        } else {
            state.containerFilter = "all";
            el.containerSelect.value = "all";
        }
    }

    /* ---------------------------------------------------------------
     * Mode (tab) switching
     * --------------------------------------------------------------- */
    function setMode(mode) {
        state.mode = mode;
        el.tabs.forEach((t) => {
            const active = t.dataset.mode === mode;
            t.classList.toggle("active", active);
            t.setAttribute("aria-selected", active ? "true" : "false");
        });
        updateProviderFilterDropdown();
        updateContainerFilterDropdown();
        render();
    }

    /* ---------------------------------------------------------------
     * Utilities
     * --------------------------------------------------------------- */
    function formatRelativeTime(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 2) { return "just now"; }
        if (seconds < 60) { return seconds + "s ago"; }
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) { return minutes + "m ago"; }
        const hours = Math.floor(minutes / 60);
        return hours + "h ago";
    }

    function prettify(str) {
        if (!str) { return ""; }
        return str.charAt(0).toUpperCase() + str.slice(1).replace(/[_-]+/g, " ");
    }

    /* ---------------------------------------------------------------
     * UI handlers
     * --------------------------------------------------------------- */
    function attachUIHandlers() {
        let pendingFrame = 0;
        el.filter.addEventListener("input", (e) => {
            state.filter = e.target.value;
            if (pendingFrame) { cancelAnimationFrame(pendingFrame); }
            pendingFrame = requestAnimationFrame(render);
        });

        el.clear.addEventListener("click", () => {
            state.items = [];
            state.expanded.clear();
            render();
            if (state.port) {
                try { state.port.postMessage({ action: "clear" }); } catch (e) { /* ignore */ }
            }
        });

        el.settings.addEventListener("click", () => { chrome.runtime.openOptionsPage(); });

        el.tabs.forEach((tab) => {
            tab.addEventListener("click", () => setMode(tab.dataset.mode));
        });

        // Provider filter dropdown
        el.providerSelect.addEventListener("change", (e) => {
            state.providerFilter = e.target.value;
            // Mark that user explicitly made a choice (even if "all"),
            // so we stop auto-selecting GA4 on future loads
            try {
                localStorage.setItem("omnibug_provider_filter", e.target.value);
                localStorage.setItem("omnibug_provider_filter_user_set", "1");
            } catch (e2) { /* ignore */ }
            // Reset container filter when changing provider since the available
            // containers may differ
            state.containerFilter = "all";
            render();
        });

        // Container filter dropdown
        el.containerSelect.addEventListener("change", (e) => {
            state.containerFilter = e.target.value;
            render();
        });

        // Toggle hide/show noise (probe/heartbeat hits)
        el.btnToggleNoise.addEventListener("click", () => {
            state.showNoise = !state.showNoise;
            try { localStorage.setItem("omnibug_show_noise", state.showNoise ? "1" : "0"); } catch (e) { /* ignore */ }
            render();
        });

        el.theme.addEventListener("click", () => toggleTheme());
        el.expand.addEventListener("click", () => toggleExpandedView());

        // Listen for system theme changes when in "auto" mode so the icon updates
        if (window.matchMedia) {
            const mq = window.matchMedia("(prefers-color-scheme: dark)");
            if (mq.addEventListener) { mq.addEventListener("change", applyTheme); }
            else if (mq.addListener) { mq.addListener(applyTheme); }
        }

        // Sort toggle
        el.sortBtn.addEventListener("click", () => {
            state.sortOrder = state.sortOrder === "desc" ? "asc" : "desc";
            el.sortLabel.textContent = state.sortOrder === "desc" ? "Newest" : "Oldest";
            el.sortBtn.title = "Toggle sort order (" + (state.sortOrder === "desc" ? "newest" : "oldest") + " first)";
            render();
        });

        // Quick-add endpoint handlers
        el.addEndpoint.addEventListener("click", () => openQuickAdd());
        el.quickAddCancel.addEventListener("click", () => closeQuickAdd());
        el.quickAddSave.addEventListener("click", () => saveQuickAddEndpoint());
        el.quickAddInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { saveQuickAddEndpoint(); }
            else if (e.key === "Escape") { closeQuickAdd(); }
        });

        setInterval(refreshTimestamps, 10000);
    }

    /* ---------------------------------------------------------------
     * Quick-add endpoint
     * --------------------------------------------------------------- */
    async function openQuickAdd() {
        el.quickAdd.classList.remove("hidden");
        // Pre-fill with the current tab's domain + "/track" as a reasonable guess
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url) {
                const u = new URL(tab.url);
                el.quickAddInput.value = u.hostname + "/track";
                el.quickAddInput.select();
            }
        } catch (e) { /* ignore */ }
        el.quickAddInput.focus();
    }

    function closeQuickAdd() {
        el.quickAdd.classList.add("hidden");
        el.quickAddInput.value = "";
    }

    async function saveQuickAddEndpoint() {
        const value = (el.quickAddInput.value || "").trim();
        if (!value) { return; }

        try {
            // Read current settings from the extension storage
            const storageArea = chrome.storage.sync || chrome.storage.local;
            const storageKey = "omnibug";

            storageArea.get(storageKey, (data) => {
                const settings = (data && data[storageKey]) || {};
                const existing = Array.isArray(settings.customGA4Patterns) ? settings.customGA4Patterns.slice() : [];

                // Avoid duplicates (case-insensitive)
                const duplicate = existing.some((p) => p.toLowerCase() === value.toLowerCase());
                if (duplicate) {
                    showStatus("Already added: " + value, 2000);
                    closeQuickAdd();
                    return;
                }

                existing.push(value);
                settings.customGA4Patterns = existing;

                const toSave = {};
                toSave[storageKey] = settings;
                storageArea.set(toSave, () => {
                    showStatus("Endpoint added: " + value, 2500);
                    closeQuickAdd();
                });
            });
        } catch (e) {
            console.error("Failed to save endpoint", e);
            showStatus("Error saving endpoint", 2500);
        }
    }

    let statusTimer = null;
    function showStatus(message, duration) {
        const original = "Listening…";
        if (statusTimer) { clearTimeout(statusTimer); }
        el.status.textContent = message;
        statusTimer = setTimeout(() => {
            el.status.textContent = original;
            statusTimer = null;
        }, duration || 2000);
    }

    function refreshTimestamps() {
        const nodes = el.list.querySelectorAll(".item-time");
        nodes.forEach((n) => {
            const ts = parseInt(n.dataset.timestamp, 10);
            if (!isNaN(ts)) { n.textContent = formatRelativeTime(ts); }
        });
    }
})();
