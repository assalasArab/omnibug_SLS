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
        filter: "",
        mode: "all",           // "all" | "hits" | "datalayer"
        sortOrder: "desc",     // "desc" (newest first) | "asc" (oldest first)
        expanded: new Set(),
        dlViewMode: {},        // itemId -> "pretty" | "raw"
        nextId: 0
    };

    // DOM refs
    const el = {
        list: document.getElementById("timeline"),
        empty: document.getElementById("empty-state"),
        filter: document.getElementById("filter"),
        clear: document.getElementById("btn-clear"),
        settings: document.getElementById("btn-settings"),
        addEndpoint: document.getElementById("btn-add-endpoint"),
        status: document.getElementById("status"),
        tabs: document.querySelectorAll(".tab"),
        countAll: document.getElementById("count-all"),
        countHits: document.getElementById("count-hits"),
        countDl: document.getElementById("count-dl"),
        sortBtn: document.getElementById("btn-sort"),
        sortLabel: document.getElementById("sort-label"),
        quickAdd: document.getElementById("quick-add"),
        quickAddInput: document.getElementById("quick-add-input"),
        quickAddSave: document.getElementById("quick-add-save"),
        quickAddCancel: document.getElementById("quick-add-cancel")
    };

    init();

    async function init() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            el.status.textContent = "No active tab";
            return;
        }
        state.tabId = tab.id;

        connect();
        attachUIHandlers();
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
            el.status.textContent = "Reconnecting…";
            state.port = null;
            setTimeout(() => { if (!state.port) { connect(); } }, 300);
        });
    }

    function handleMessage(msg) {
        if (!msg || !msg.event) { return; }

        if (msg.event === "history") {
            state.items = [];
            (msg.requests || []).forEach((r) => addHit(r, false));
            (msg.dataLayerEvents || []).forEach((e) => addDataLayerEvent(e, false));
            recomputeCorrelations();
            render();
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
            state.items = [];
            state.expanded.clear();
            render();
        }
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

        return {
            id: id,
            kind: "hit",
            providerKey: provider.key || "UNKNOWN",
            providerName: provider.name || "Unknown",
            providerType: provider.type || "",
            requestType: requestType,
            account: account,
            url: (raw.request && raw.request.url) || "",
            method: (raw.request && raw.request.method) || "GET",
            timestamp: (raw.request && raw.request.timestamp) || Date.now(),
            groups: provider.groups || [],
            data: data,
            // Filled by recomputeCorrelations()
            triggeredBy: null   // id of a dataLayer event
        };
    }

    function addDataLayerEvent(raw, shouldRender) {
        const ev = {
            id: ++state.nextId,
            kind: "dl",
            layer: raw.layer || "dataLayer",
            payload: raw.payload || {},
            timestamp: raw.timestamp || Date.now(),
            origin: raw.origin || "push",
            // Try to identify the event name for correlation
            eventName: extractEventName(raw.payload),
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
    function render() {
        const filter = state.filter.toLowerCase().trim();

        let visible = state.items.slice();

        // Mode filter
        if (state.mode === "hits") { visible = visible.filter((it) => it.kind === "hit"); }
        else if (state.mode === "datalayer") { visible = visible.filter((it) => it.kind === "dl"); }

        // Text filter
        if (filter) { visible = visible.filter((it) => itemMatchesFilter(it, filter)); }

        // Sort order
        if (state.sortOrder === "asc") {
            visible.sort((a, b) => a.timestamp - b.timestamp);
        } else {
            visible.sort((a, b) => b.timestamp - a.timestamp);
        }

        // Counts
        const hitCount = state.items.filter((it) => it.kind === "hit").length;
        const dlCount = state.items.filter((it) => it.kind === "dl").length;
        el.countAll.textContent = state.items.length;
        el.countHits.textContent = hitCount;
        el.countDl.textContent = dlCount;

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
            frag.appendChild(it.kind === "hit" ? renderHitItem(it) : renderDlItem(it));
        });
        el.list.appendChild(frag);
    }

    function itemMatchesFilter(item, filter) {
        if (item.kind === "hit") {
            if (item.providerName.toLowerCase().includes(filter)) { return true; }
            if (item.requestType.toLowerCase().includes(filter)) { return true; }
            if (item.account.toLowerCase().includes(filter)) { return true; }
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
            subtitle: hit.account || hit.url.replace(/^https?:\/\//, "").split(/[?#]/)[0]
        }));

        // Correlation: "triggered by dataLayer: xxx"
        if (hit.triggeredBy) {
            const parent = state.items.find((x) => x.id === hit.triggeredBy);
            if (parent) {
                const corr = document.createElement("div");
                corr.className = "correlation";
                const pill = buildPill("from-dl", "⟵ from dataLayer: " + (parent.eventName || "push"), parent.id);
                corr.appendChild(pill);
                li.appendChild(corr);
            }
        }

        if (state.expanded.has(hit.id)) {
            li.appendChild(renderHitDetails(hit));
        }

        return li;
    }

    function renderHitDetails(hit) {
        const wrap = document.createElement("div");
        wrap.className = "item-details";

        const urlBox = document.createElement("div");
        urlBox.className = "item-url";
        urlBox.textContent = hit.method + " " + hit.url;
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
                keyEl.textContent = p.field || p.key || "";

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

    /* ----------- DataLayer item rendering ----------- */

    function renderDlItem(ev) {
        const li = document.createElement("li");
        li.className = "item dl";
        li.dataset.id = String(ev.id);
        if (state.expanded.has(ev.id)) { li.classList.add("expanded"); }

        // Build a short preview of payload keys for the subtitle
        let subtitle = "";
        if (ev.payload && typeof ev.payload === "object") {
            const keys = Object.keys(ev.payload).filter((k) => k !== "event");
            if (keys.length > 0) { subtitle = "{ " + keys.slice(0, 4).join(", ") + (keys.length > 4 ? ", …" : "") + " }"; }
            else if (ev.origin === "initial") { subtitle = "initial state"; }
        }

        li.appendChild(buildSummary(ev, {
            fallbackLetter: "DL",
            kindLabel: ev.layer,
            eventLabel: ev.eventName || "(no event name)",
            subtitle: subtitle
        }));

        // Correlation: "→ 2 hits triggered"
        if (ev.triggeredHits.length > 0) {
            const corr = document.createElement("div");
            corr.className = "correlation";

            // Show distinct provider names as separate pills, up to 3
            const hitsByProvider = {};
            ev.triggeredHits.forEach((hitId) => {
                const h = state.items.find((x) => x.id === hitId);
                if (h) {
                    if (!hitsByProvider[h.providerName]) { hitsByProvider[h.providerName] = []; }
                    hitsByProvider[h.providerName].push(h);
                }
            });

            const providerNames = Object.keys(hitsByProvider);
            providerNames.slice(0, 3).forEach((name) => {
                const hits = hitsByProvider[name];
                const first = hits[0];
                const label = "→ " + name + (hits.length > 1 ? " × " + hits.length : "");
                corr.appendChild(buildPill("to-hit", label, first.id));
            });
            if (providerNames.length > 3) {
                const extra = document.createElement("span");
                extra.className = "corr-pill";
                extra.textContent = "+" + (providerNames.length - 3);
                corr.appendChild(extra);
            }
            li.appendChild(corr);
        }

        if (state.expanded.has(ev.id)) {
            li.appendChild(renderDlDetails(ev));
        }

        return li;
    }

    function renderDlDetails(ev) {
        const wrap = document.createElement("div");
        wrap.className = "item-details";

        const meta = document.createElement("div");
        meta.className = "item-url";
        meta.textContent = ev.layer + "." + (ev.origin === "initial" ? "(pre-existing)" : "push()") + "   " + new Date(ev.timestamp).toLocaleTimeString();
        wrap.appendChild(meta);

        // View-mode toggle: Pretty (default) / Raw JSON
        const viewMode = state.dlViewMode[ev.id] || "pretty";

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

        wrap.appendChild(toggle);

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

        // Icon
        if (opts.iconSrc) {
            const img = document.createElement("img");
            img.className = "item-icon";
            img.width = 16;
            img.height = 16;
            img.alt = "";
            img.src = opts.iconSrc;
            img.addEventListener("error", () => {
                const placeholder = document.createElement("span");
                placeholder.className = "item-icon-placeholder";
                placeholder.textContent = opts.fallbackLetter;
                if (img.parentNode) { img.parentNode.replaceChild(placeholder, img); }
            });
            summary.appendChild(img);
        } else {
            const placeholder = document.createElement("span");
            placeholder.className = "item-icon-placeholder";
            placeholder.textContent = opts.fallbackLetter;
            summary.appendChild(placeholder);
        }

        // Main
        const main = document.createElement("div");
        main.className = "item-main";

        const top = document.createElement("div");
        top.className = "item-top";

        const kind = document.createElement("span");
        kind.className = "item-kind";
        kind.textContent = opts.kindLabel;
        top.appendChild(kind);

        if (opts.eventLabel) {
            const ev = document.createElement("span");
            ev.className = "item-event";
            ev.textContent = opts.eventLabel;
            top.appendChild(ev);
        }
        main.appendChild(top);

        const bottom = document.createElement("div");
        bottom.className = "item-bottom";

        const sub = document.createElement("span");
        sub.className = "item-subtitle";
        sub.textContent = opts.subtitle || "";
        bottom.appendChild(sub);

        const time = document.createElement("span");
        time.className = "item-time";
        time.textContent = formatRelativeTime(item.timestamp);
        time.dataset.timestamp = String(item.timestamp);
        bottom.appendChild(time);

        main.appendChild(bottom);
        summary.appendChild(main);

        const chevron = document.createElement("span");
        chevron.className = "item-chevron";
        chevron.textContent = "▶";
        summary.appendChild(chevron);

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
     * Mode (tab) switching
     * --------------------------------------------------------------- */
    function setMode(mode) {
        state.mode = mode;
        el.tabs.forEach((t) => {
            const active = t.dataset.mode === mode;
            t.classList.toggle("active", active);
            t.setAttribute("aria-selected", active ? "true" : "false");
        });
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
