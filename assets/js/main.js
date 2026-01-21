/**
 * Juncture client helpers
 * ----------------------
 * Assumes this file is loaded as an ES module (e.g., <script type="module" ...>).
 *
 * Key goals:
 * - Avoid O(N_iframes * N_links) loops
 * - Reduce XSS / injection risk (avoid innerHTML where not needed; validate URLs)
 * - Avoid double-wrapping / double-binding
 * - Make async fetches more robust (timeouts, per-request error handling)
 * - Fix a few Wikidata query/response mismatches and ordering issues
 */

import "https://cdn.jsdelivr.net/npm/js-md5@0.8.3/src/md5.min.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/button/button.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/card/card.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/carousel/carousel.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/carousel-item/carousel-item.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/copy-button/copy-button.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/dialog/dialog.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/dropdown/dropdown.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/tab/tab.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/tab-group/tab-group.js";
import "https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace/cdn/components/tab-panel/tab-panel.js";

/* ---------------------------------------------
 * Environment / config
 * ------------------------------------------- */

// Touch + small viewport tends to be a better “mobile-ish” proxy than UA sniffing alone.
const isCoarsePointer =
    window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
const isNarrowViewport =
    window.matchMedia?.("(max-width: 768px)")?.matches ?? false;
const isMobile = isCoarsePointer || isNarrowViewport;

// If true, action links are disabled (no href + styled as plain text)
const isStatic = false;

// If you can, set this to your domain(s) to reject arbitrary postMessage senders.
// Example: new Set([location.origin])
const allowedMessageOrigins = null; // null = allow all (current behavior)

/* ---------------------------------------------
 * Small utilities
 * ------------------------------------------- */

function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
}

function parseAspect(value, fallback = 1) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function safeURL(urlLike, base = location.href) {
    // Accepts absolute or relative URLs. Returns URL instance or null.
    try {
        const u = new URL(urlLike, base);
        // If you want to restrict protocols, do it here:
        if (!["http:", "https:"].includes(u.protocol)) return null;
        return u;
    } catch {
        return null;
    }
}

/**
 * Fetch with timeout and sane defaults.
 */
async function fetchJson(url, { timeoutMs = 12000, ...opts } = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetch(url, { ...opts, signal: controller.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
        return await resp.json();
    } finally {
        clearTimeout(t);
    }
}

/* ---------------------------------------------
 * Dialog (single instance)
 * ------------------------------------------- */

let activeDialog = null;

function computeDialogWidth({ aspect }) {
    const ar = parseAspect(aspect, 1);
    const captionHeight = 36; // px (your assumption)
    // Effective AR when the iframe includes a caption area below in the frame itself
    const arWithCaption = window.innerWidth / (window.innerWidth / ar + captionHeight);

    const w =
        arWithCaption > 1
            ? window.innerWidth * 0.93
            : window.innerHeight * arWithCaption * 0.93;

    // Avoid absurd widths
    return clamp(Math.round(w), 320, Math.round(window.innerWidth * 0.98));
}

function showDialog(props = {}) {
    if (activeDialog) return;
    const aspect = parseAspect(props.aspect, 1);
    const srcUrl = safeURL(props.src);
    if (!srcUrl) {
        console.warn("showDialog: invalid src", props.src);
        return;
    }

    const width = computeDialogWidth({ aspect });

    const dialog = document.createElement("sl-dialog");
    dialog.id = "junctureDialog";
    dialog.setAttribute("size", "large");
    dialog.setAttribute("no-header", "");
    dialog.style.setProperty("--width", `${width}px`);

    // Clean up when hidden
    dialog.addEventListener(
        "sl-after-hide",
        () => {
            dialog.remove();
            activeDialog = null;
        },
        { once: true }
    );

    const closeButton = document.createElement("sl-button");
    closeButton.setAttribute("slot", "footer");
    closeButton.setAttribute("variant", "primary");
    closeButton.setAttribute("size", "small");
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => dialog.hide());
    dialog.appendChild(closeButton);

    const wrapper = document.createElement("div");

    const iframe = document.createElement("iframe");
    iframe.style.width = "100%";
    iframe.style.aspectRatio = String(aspect);
    iframe.loading = "lazy";
    iframe.allow = "clipboard-write";
    iframe.setAttribute("allowfullscreen", "");
    iframe.src = srcUrl.toString();

    wrapper.appendChild(iframe);
    dialog.appendChild(wrapper);

    document.body.appendChild(dialog);
    activeDialog = dialog;
    dialog.show();
}

/* ---------------------------------------------
 * postMessage handling
 * ------------------------------------------- */

function isOriginAllowed(origin) {
    if (!allowedMessageOrigins) return true;
    return allowedMessageOrigins.has(origin);
}

function findIframeBySourceWindow(sourceWindow) {
    // Note: querySelectorAll('iframe') can be expensive if huge DOM;
    // but message events should be infrequent.
    for (const iframe of document.querySelectorAll("iframe")) {
        if (iframe.contentWindow === sourceWindow) return iframe;
    }
    return null;
}

function addMessageHandler() {
    window.addEventListener("message", (event) => {
        if (!isOriginAllowed(event.origin)) return;

        const data = event.data;

        // Accept either raw objects OR JSON strings (some of your code uses JSON.stringify elsewhere)
        let msg = data;
        if (typeof data === "string") {
            try {
                msg = JSON.parse(data);
            } catch {
                // not JSON; ignore
                return;
            }
        }

        if (!msg || typeof msg !== "object") return;

        if (msg.type === "setAspect") {
            const sendingIframe = findIframeBySourceWindow(event.source);
            if (sendingIframe) {
                sendingIframe.style.aspectRatio = String(parseAspect(msg.aspect, 1));
            }
            return;
        }

        if (msg.type === "showDialog") {
            showDialog(msg.props);
            return;
        }

        if (msg.type === "openLink") {
            const url = safeURL(msg.url);
            if (!url) return;
            window.open(url.toString(), msg.newtab ? "_blank" : "_self");
            return;
        }
    });
}

addMessageHandler();

/* ---------------------------------------------
 * Wrap adjacent embeds as Shoelace tabs
 * ------------------------------------------- */

function wrapAdjacentEmbedsAsTabs({
    root = document.body,
    minRunLength = 2,
    wrapperClass = "embed-tabs",
    iconFor = (node) => {
        if (node.classList.contains('embed-image')) return "fa-regular fa-image";
        if (node.classList.contains('embed-map')) return "fa-solid fa-map-pin";
        if (node.classList.contains('embed-image-compare')) return "fa-regular fa-images";
        if (node.classList.contains('embed-youtube')) return "fa-brands fa-youtube";
        if (node.classList.contains('iframe-wrapper')) return "fa-regular fa-file-lines";
        return "fa-solid fa-square";
    },
    labelFor = (node, idx) => {
        if (node.tagName === "IFRAME") return `Map ${idx + 1}`;
        if (node.tagName === "P" && node.querySelector("img")) return `Image ${idx + 1}`;
        return `Item ${idx + 1}`;
    }
} = {}) {
    const isIgnorableText = (n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim() === "";

    const isEmbedItem = (n) =>
        n instanceof Element &&
        (n.tagName === "IFRAME" || n.tagName === "FIGURE" || (n.tagName === "P" && n.querySelector("img")));

    const nextNonIgnorableSibling = (node) => {
        let n = node.nextSibling;
        while (n && isIgnorableText(n)) n = n.nextSibling;
        return n;
    };

    let panelCounter = 0;

    // Iterating every element (*) is heavy, but safer than assuming structure.
    // If performance becomes an issue, scope root to article content only.
    for (const parent of root.querySelectorAll("*")) {
        if (!parent.childNodes?.length) continue;

        let nodes = Array.from(parent.childNodes);
        let i = 0;

        while (i < nodes.length) {
            const start = nodes[i];

            if (!isEmbedItem(start)) {
                i++;
                continue;
            }

            const run = [start];
            let cursor = start;

            while (true) {
                const next = nextNonIgnorableSibling(cursor);
                if (next && isEmbedItem(next)) {
                    run.push(next);
                    cursor = next;
                    continue;
                }
                break;
            }

            if (run.length >= minRunLength) {
                if (run[0].closest(`sl-tab-group.${wrapperClass}`)) {
                    i++;
                    continue;
                }

                const tabGroup = document.createElement("sl-tab-group");
                tabGroup.classList.add(wrapperClass, "right");

                parent.insertBefore(tabGroup, run[0]);

                run.forEach((node, idx) => {
                    const panelName = `embed-panel-${++panelCounter}`;
                    const label = labelFor(node, idx);

                    const tab = document.createElement("sl-tab");
                    tab.slot = "nav";
                    tab.panel = panelName;
                    tab.setAttribute("aria-label", label);
                    tab.title = label;

                    const icon = document.createElement("i");
                    icon.className = iconFor(node);
                    icon.setAttribute("aria-hidden", "true");
                    tab.appendChild(icon);

                    const panel = document.createElement("sl-tab-panel");
                    panel.name = panelName;
                    panel.appendChild(node);

                    tabGroup.appendChild(tab);
                    tabGroup.appendChild(panel);
                });

                // Refresh snapshot after mutation
                nodes = Array.from(parent.childNodes);
                i = nodes.indexOf(tabGroup) + 1;
                continue;
            }

            i++;
        }
    }
}

wrapAdjacentEmbedsAsTabs();

/* ---------------------------------------------
 * Float repositioning: wrap media + paragraphs
 * ------------------------------------------- */

function repositionFloats({ root = document.body } = {}) {
    // Avoid re-wrapping
    const floats = Array.from(root.querySelectorAll(".left, .right")).reverse();

    floats.forEach((floatedEl) => {
        if (floatedEl.closest(".media-pair")) return;

        const parent = floatedEl.parentNode;
        if (!parent) return;

        // Find contiguous preceding <p> blocks
        let p = floatedEl.previousElementSibling;

        const paras = [];
        while (p && p.tagName === "P" && !p.classList.contains("left") && !p.classList.contains("right")) {
            p.classList.add("text");
            paras.push(p);
            p = p.previousElementSibling;
        }

        if (paras.length === 0) {
            parent.insertBefore(floatedEl, parent.firstElementChild);
            return;
        }

        paras.reverse();
        const anchor = paras[0];

        const wrapper = document.createElement("div");
        wrapper.className = "media-pair";

        parent.insertBefore(wrapper, anchor);
        wrapper.appendChild(floatedEl);
        paras.forEach((pEl) => wrapper.appendChild(pEl));
    });
}

if (!isMobile) repositionFloats();

/* ---------------------------------------------
 * Action links -> iframe postMessage
 * ------------------------------------------- */

function objectFromLink(linkEl, attrs) {
    const obj = {};
    for (const name of attrs) {
        if (linkEl.hasAttribute(name)) obj[name] = linkEl.getAttribute(name);
    }
    return obj;
}

/**
 * Parse action target/action/args from either:
 * - explicit attributes: action/label/target/args
 * - or URL path that contains .../<iframeId>/<action>/<args...>
 */
function parseActionLink(a) {
    const linkAttrs = objectFromLink(a, ["action", "label", "target", "args"]);
    const href = a.getAttribute("href") || a.getAttribute("data-href") || "";

    // If explicit args provided, accept them as a simple split (comma or space are common).
    // If you need to support JSON-in-attr, do it here.
    const explicitArgs =
        typeof linkAttrs.args === "string" && linkAttrs.args.trim()
            ? linkAttrs.args.split(/[\s,]+/).filter(Boolean)
            : null;

    const url = safeURL(href) || safeURL(a.getAttribute("data-href") || "");
    const pathParts = url
        ? url.pathname.split("/").filter((p) => p && p !== "#")
        : [];

    return {
        href,
        target: linkAttrs.target || null,
        action: linkAttrs.action || null,
        label: linkAttrs.label || a.textContent || "",
        explicitArgs,
        pathParts
    };
}

function addActionLinks({ root = document.body } = {}) {
    const iframes = Array.from(root.querySelectorAll("iframe")).filter((i) => i.id);

    if (!iframes.length) return;

    // Index iframes by id for quick lookup
    const iframeById = new Map(iframes.map((i) => [i.id, i]));

    // Process each <a> once (avoid nested loops)
    const links = Array.from(root.querySelectorAll("a"));

    for (const a of links) {
        // Avoid double-binding
        if (a.dataset.actionBound === "1") continue;

        const parsed = parseActionLink(a);

        // Determine target/action/args
        // Priority:
        // 1) explicit target/action/args (attrs)
        // 2) infer from path containing iframeId
        let target = parsed.target;
        let action = parsed.action;
        let args = parsed.explicitArgs;

        if (!target || !action || !args?.length) {
            // Try inferring from URL path if it includes an iframe id
            const idx = parsed.pathParts.findIndex((p) => iframeById.has(p));
            if (idx >= 0) {
                target = target || parsed.pathParts[idx];
                action = action || parsed.pathParts[idx + 1];
                args = args || parsed.pathParts.slice(idx + 2);
            }
        }

        if (!target || !action || !args?.length) continue;

        const iframe = iframeById.get(target);
        if (!iframe) continue;

        // If isStatic, disable link but keep it readable
        if (isStatic) {
            a.removeAttribute("href");
            a.style.color = "inherit";
            a.style.cursor = "default";
            a.dataset.actionBound = "1";
            continue;
        }

        // Convert to a trigger link (store original href)
        if (a.hasAttribute("href")) {
            a.setAttribute("data-href", parsed.href);
            a.removeAttribute("href");
        }

        a.classList.add("trigger");
        a.style.cursor = "pointer";
        a.dataset.actionBound = "1";

        a.addEventListener("click", (e) => {
            e.preventDefault();
            const msg = { event: "action", action, text: parsed.label, args };
            // Your iframe side expects JSON strings; keep compatibility
            iframe.contentWindow?.postMessage(JSON.stringify(msg), "*");
        });
    }
}

addActionLinks();

/* ---------------------------------------------
 * Wikidata / Wikipedia helpers
 * ------------------------------------------- */

function mwImage(mwImg, width = 0) {
    // Converts Wikimedia commons image URL to a thumbnail link.
    // Accepts:
    // - full URL
    // - "Special:FilePath/..."
    // - "File:..."
    // - "wc:..."
    let name = mwImg
        .replace(/^wc:/, "")
        .replace(/Special:FilePath\//, "File:")
        .split("File:")
        .pop();

    name = decodeURIComponent(name).replace(/ /g, "_");

    const _md5 = md5(name);
    const extension = name.split(".").pop()?.toLowerCase();
    let url = `https://upload.wikimedia.org/wikipedia/commons${width ? "/thumb" : ""}`;
    url += `/${_md5.slice(0, 1)}/${_md5.slice(0, 2)}/${name}`;

    if (width > 0) {
        url += `/${width}px-${name}`;
        if (extension === "svg") url += ".png";
        if (extension === "tif" || extension === "tiff") url += ".jpg";
    }

    return url;
}

// Creates a GeoJSON file URL from a Who's on First ID
function whosOnFirstUrl(wof) {
    const parts = [];
    for (let i = 0; i < wof.length; i += 3) parts.push(wof.slice(i, i + 3));
    return `https://data.whosonfirst.org/${parts.join("/")}/${wof}.geojson`;
}

function extractQidFromAnchor(a) {
    const direct = a.getAttribute("qid");
    if (direct && /^Q\d+$/.test(direct)) return direct;

    const href = a.getAttribute("href") || "";
    const url = safeURL(href);
    const pathParts = url ? url.pathname.split("/").filter(Boolean) : [];

    const q = pathParts.find((p) => /^Q\d+$/.test(p));
    return q || null;
}

async function getEntityData(qids, language = "en") {
    const entities = {};
    if (!Array.isArray(qids) || qids.length === 0) return entities;

    const entityUrls = qids.map((qid) => `(wd:${qid})`);

    // NOTE: you used SAMPLE(label/description) but filtered to "en" hard-coded.
    // If you actually want `language`, adjust FILTER(LANG(...) = "...") accordingly.
    const lang = language || "en";

    const query = `
    SELECT
      ?item
      (SAMPLE(?label) AS ?label)
      (SAMPLE(?description) AS ?description)
      (GROUP_CONCAT(DISTINCT ?alias; separator=" | ") AS ?aliases)
      (SAMPLE(?image) AS ?image)
      (SAMPLE(?logoImage) AS ?logoImage)
      (SAMPLE(?coords) AS ?coords)
      (SAMPLE(?pageBanner) AS ?pageBanner)
      (SAMPLE(?whosOnFirst) AS ?whosOnFirst)
      (SAMPLE(?wikipedia) AS ?wikipedia)
    WHERE {
      VALUES (?item) { ${entityUrls.join(" ")} }

      OPTIONAL { ?item rdfs:label ?label . FILTER (LANG(?label) = "${lang}") }
      OPTIONAL { ?item schema:description ?description . FILTER (LANG(?description) = "${lang}") }
      OPTIONAL { ?item skos:altLabel ?alias . FILTER (LANG(?alias) = "${lang}") }

      OPTIONAL { ?item wdt:P625 ?coords . }
      OPTIONAL { ?item wdt:P18 ?image . }
      OPTIONAL { ?item wdt:P154 ?logoImage . }
      OPTIONAL { ?item wdt:P948 ?pageBanner . }
      OPTIONAL { ?item wdt:P6766 ?whosOnFirst . }

      OPTIONAL { ?wikipedia schema:about ?item; schema:isPartOf <https://${lang}.wikipedia.org/> . }
    }
    GROUP BY ?item
  `;

    let sparqlResp;
    try {
        // Wikidata endpoint sometimes prefers GET; POST is fine, but be ready for 429.
        sparqlResp = await fetchJson("https://query.wikidata.org/sparql", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/sparql-results+json"
            },
            body: `query=${encodeURIComponent(query)}`,
            timeoutMs: 20000
        });
    } catch (err) {
        console.error("Wikidata SPARQL error:", err);
        return entities;
    }

    // Prepare Wikipedia summary fetches (keep ordering stable)
    const summaryFetches = [];

    for (const rec of sparqlResp.results?.bindings || []) {
        const qid = rec.item?.value?.split("/").pop();
        if (!qid) continue;

        const e = { id: qid };

        if (rec.label?.value) e.label = rec.label.value;
        if (rec.description?.value) e.description = rec.description.value;

        // NOTE: your old code checked `rec.alias`, but the query returns `?aliases`
        if (rec.aliases?.value) {
            e.aliases = rec.aliases.value.split(" | ").map((s) => s.trim()).filter(Boolean);
        }

        if (rec.coords?.value) {
            // "Point(lon lat)" -> "lat,lon"
            e.coords = rec.coords.value.slice(6, -1).split(" ").reverse().join(",");
        }

        if (rec.wikipedia?.value) e.wikipedia = rec.wikipedia.value;
        if (rec.pageBanner?.value) e.pageBanner = rec.pageBanner.value;

        if (rec.image?.value) {
            e.image = rec.image.value;
            e.thumbnail = mwImage(rec.image.value, 300);
        }

        if (rec.logoImage?.value) {
            e.logoImage = rec.logoImage.value;
            if (!e.thumbnail) e.thumbnail = mwImage(rec.logoImage.value, 300);
        }

        if (rec.whosOnFirst?.value) e.geojson = whosOnFirstUrl(rec.whosOnFirst.value);

        // Wikipedia summary
        if (e.wikipedia) {
            // Normalize: /w/ -> /wiki/ then take title after /wiki/
            const title = e.wikipedia
                .replace(/\/w\//, "/wiki/")
                .split("/wiki/")
                .pop();

            if (title) {
                const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
                summaryFetches.push({ qid, summaryUrl });
            }
        }

        entities[qid] = e;
    }

    // Fetch summaries concurrently, but safely
    await Promise.all(
        summaryFetches.map(async ({ qid, summaryUrl }) => {
            try {
                const data = await fetchJson(summaryUrl, { timeoutMs: 12000 });
                const text = data.extract_html || data.extract;
                if (text && entities[qid]) entities[qid].summaryText = text;
            } catch (err) {
                // Non-fatal
                console.warn("Wikipedia summary fetch failed:", summaryUrl, err);
            }
        })
    );

    return entities;
}

/**
 * Replace <a qid="Q..."> (or links with /Q... in URL path) with a Shoelace dropdown popup.
 * NOTE: this *replaces* the anchor, so you lose the original link semantics unless you
 * add them back explicitly in the card footer.
 */
async function makeEntityPopups({ root = document.body, language = "en" } = {}) {
    const anchors = Array.from(root.querySelectorAll("a"));
    const qids = new Set();

    for (const a of anchors) {
        const qid = extractQidFromAnchor(a);
        if (qid) qids.add(qid);
    }

    const entities = await getEntityData(Array.from(qids), language);

    for (const a of anchors) {
        const qid = extractQidFromAnchor(a);
        if (!qid) continue;

        const entity = entities[qid];
        if (!entity) continue;

        const dd = document.createElement("sl-dropdown");
        dd.className = "entity-popup";
        dd.setAttribute("placement", "top");
        dd.setAttribute("distance", "12");

        // Trigger: avoid innerHTML (use textContent)
        const trigger = document.createElement("span");
        trigger.setAttribute("slot", "trigger");
        trigger.textContent = a.textContent || entity.label || qid;
        dd.appendChild(trigger);

        const card = document.createElement("sl-card");
        card.setAttribute("hoist", "");

        if (entity.thumbnail) {
            const img = document.createElement("img");
            img.setAttribute("slot", "image");
            img.src = entity.thumbnail;
            img.alt = entity.label || qid;
            card.appendChild(img);
        }

        const content = document.createElement("div");
        content.className = "content";

        if (entity.label) {
            const heading = document.createElement("h2");
            heading.textContent = entity.label;
            content.appendChild(heading);
        }

        if (entity.description) {
            const description = document.createElement("p");
            description.className = "description";
            description.textContent = entity.description;
            content.appendChild(description);
        }

        if (entity.summaryText) {
            // Wikipedia returns HTML in extract_html; if you render that directly you’re trusting Wikipedia.
            // If you want to avoid HTML entirely, use extract (plain text) only.
            const summary = document.createElement("div");
            summary.className = "description";
            summary.innerHTML = entity.summaryText;
            content.appendChild(summary);
        }

        card.appendChild(content);

        const footer = document.createElement("div");
        footer.setAttribute("slot", "footer");

        if (entity.wikipedia) {
            const wikiLink = document.createElement("a");
            wikiLink.href = entity.wikipedia;
            wikiLink.target = "_blank";
            wikiLink.rel = "noopener noreferrer";
            wikiLink.textContent = "View on Wikipedia";
            footer.appendChild(wikiLink);
        }

        card.appendChild(footer);
        dd.appendChild(card);

        a.replaceWith(dd);
    }
}

makeEntityPopups();

/* ---------------------------------------------
 * Optional exports (if you import this elsewhere)
 * ------------------------------------------- */
// export { repositionFloats, makeEntityPopups, wrapAdjacentEmbedsAsTabs, addActionLinks, showDialog };
