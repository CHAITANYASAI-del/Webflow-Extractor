// content.js — runs inside the Webflow tab.
// 1. Tells the popup whether this is a Webflow site.
// 2. Reports every file the live page actually loaded, so assets that only
//    appear at runtime (lazy images, JS-created media) are not missed.
// The saved HTML itself comes from Webflow's server (not this live DOM): the
// live DOM has animation start/end states and runtime classes baked in.
(function () {
  'use strict';
  if (window.__wfxLoaded) return;
  window.__wfxLoaded = true;

  function detectWebflow() {
    const el = document.documentElement;
    return !!(
      el.hasAttribute('data-wf-site') ||
      el.hasAttribute('data-wf-page') ||
      document.querySelector('meta[name="generator"][content*="Webflow" i]') ||
      document.querySelector('link[href*="website-files.com"], script[src*="website-files.com"]') ||
      /\.webflow\.io$/i.test(location.hostname)
    );
  }

  function loadedResources() {
    try {
      return [...new Set(performance.getEntriesByType('resource').map(e => e.name))];
    } catch { return []; }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'CHECK_WEBFLOW') {
      sendResponse({ isWebflow: detectWebflow(), url: location.href });
      return true;
    }
    if (msg.type === 'SCAN_PAGE') {
      sendResponse({
        success: true,
        data: { pageUrl: location.href, pageTitle: document.title, isWebflow: detectWebflow(), urls: loadedResources() },
      });
      return true;
    }
  });
})();
