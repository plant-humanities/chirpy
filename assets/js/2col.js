import "./main.js";
import "https://cdnjs.cloudflare.com/ajax/libs/scrollama/3.2.0/scrollama.min.js";

/**
 * Two-column scrollytelling:
 * - Left column: article text steps
 * - Right column: "viewer" mirrors the most recent media element before the active paragraph
 *
 * Behavior:
 * - On entering a step paragraph, mark it active and update the viewer.
 * - Viewer content is cloned from the nearest preceding IFRAME or element with class "right".
 * - Viewer is positioned to the right of the article and sized to half the article width.
 */

const SELECTORS = {
  article: "article",
  header: "article > header",
  viewer: ".viewer",
  step: ".post-content p.text",
};

const scroller = scrollama();

let els = {
  article: null,
  header: null,
  viewer: null,
};

// Cache last rendered "source" node so we don’t redraw unnecessarily
let lastSourceEl = null;

// rAF throttle for position updates
let rafPending = false;

function qs(sel, root = document) {
  return root.querySelector(sel);
}

function setActive(el) {
  const prior = qs(".active");
  if (prior) prior.classList.remove("active");
  el.classList.add("active");
}

/**
 * Walk backward from a step paragraph to find the nearest content element
 * that should be mirrored into the right viewer.
 *
 * Rules (matching your original):
 * - Use an IFRAME, OR
 * - Use an element with class "right"
 */
function findViewerSource(stepEl) {
  let node = stepEl?.previousElementSibling || null;

  while (node) {
    const isIframe = node.nodeName === "IFRAME";
    const isRight = node.classList?.contains("right");
    if (isIframe || isRight) return node;
    node = node.previousElementSibling;
  }
  return null;
}

/**
 * Clone the source node into the viewer.
 * - Removes `.shimmer` class if present (avoids placeholder styles in clone).
 */
function renderViewerFrom(sourceEl) {
  if (!els.viewer || !sourceEl) return;

  // Avoid replacing if the source element is the same as last time.
  if (sourceEl === lastSourceEl) return;
  lastSourceEl = sourceEl;

  const clone = sourceEl.cloneNode(true);

  // Some nodes might not support querySelector; guard it.
  if (clone && clone.querySelector) {
    clone.querySelector(".shimmer")?.classList.remove("shimmer");
  }

  // In case original was hidden
  if (clone?.style) clone.style.display = "block";

  // Replace viewer content atomically
  els.viewer.replaceChildren(clone);
}

function updateViewerForStep(stepEl) {
  const source = findViewerSource(stepEl);
  if (!source) return;
  renderViewerFrom(source);
}

/**
 * Compute and apply viewer position and size.
 * Original behavior:
 * - viewer height = viewport minus header bottom (with small fudge)
 * - viewer width = half article width
 * - viewer right offset = distance from article right to window right
 */
function positionViewer() {
  if (!els.article || !els.header || !els.viewer) return;

  const articleRect = els.article.getBoundingClientRect();
  const headerRect = els.header.getBoundingClientRect();

  // Height available below header (clamp to >= 0)
  const availableH = Math.max(0, window.innerHeight - headerRect.bottom - 2);

  const viewerW = articleRect.width / 2;
  const rightOffset = Math.max(0, window.innerWidth - articleRect.right);

  els.viewer.style.height = `${availableH}px`;
  els.viewer.style.width = `${viewerW}px`;
  els.viewer.style.right = `${rightOffset}px`;
}

/**
 * Throttle position updates to animation frames (avoids layout thrash on scroll).
 */
function requestPositionUpdate() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    positionViewer();
  });
}

function handleStepEnter(response) {
  const stepEl = response?.element;
  if (!stepEl) return;

  setActive(stepEl);
  updateViewerForStep(stepEl);

  // Sometimes layout changes when viewer content changes; reposition.
  requestPositionUpdate();
}

function init2col() {
  els.article = qs(SELECTORS.article);
  els.header = qs(SELECTORS.header);
  els.viewer = qs(SELECTORS.viewer);

  if (!els.article || !els.header || !els.viewer) {
    // Fail quietly; this script may be used on pages without the 2-col layout.
    return;
  }

  // Position updates on scroll/resize
  window.addEventListener("scroll", requestPositionUpdate, { passive: true });
  window.addEventListener("resize", requestPositionUpdate);

  // Initial position (next frame is usually better than setTimeout)
  requestPositionUpdate();

  scroller
    .setup({
      step: SELECTORS.step,
      offset: 0.05,
      debug: false,
    })
    .onStepEnter(handleStepEnter);

  // Optional: if images/iframes load late and change layout, reposition.
  // (Cheap, but you can remove if unnecessary.)
  window.addEventListener("load", requestPositionUpdate);
}

init2col();