// Isolated-world bridge. Loads settings, shares them with the other
// isolated scripts, and relays messages between the page-context script
// (anti-redirect.js) and the service worker.
(() => {
  'use strict';
  const DEFAULTS = {
    enabled: true, blockNotifications: true, youtubeSkip: true, strictRedirects: true,
    allowlist: [], customBlocked: []
  };

  // The site the person is on: for an iframe, that is the top page, not the iframe's own host.
  const siteHost = (() => {
    try {
      if (window === window.top) return location.hostname;
      const origins = location.ancestorOrigins;
      if (origins && origins.length) return new URL(origins[origins.length - 1]).hostname;
    } catch (_) {}
    return location.hostname;
  })().toLowerCase();

  const isAllowed = (list) => list.some((d) => siteHost === d || siteHost.endsWith('.' + d));
  const derive = (s) => ({ ...s, active: s.enabled && !isAllowed(s.allowlist) });

  const settings = chrome.storage.local.get(DEFAULTS).then(derive);

  // Shared with element-blocker.js and youtube.js (same isolated world).
  globalThis.__adshield = { settings };

  const sendConfig = (s) =>
    window.postMessage({ source: 'adshield-content', type: 'config', enabled: s.active, strict: s.strictRedirects }, '*');

  settings.then(sendConfig);

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== 'adshield-main') return;
    if (d.type === 'ready') settings.then(sendConfig);
    if (d.type === 'blocked') {
      chrome.runtime.sendMessage({
        type: 'blocked',
        kind: String(d.kind).slice(0, 20),
        host: String(d.host || '').slice(0, 100)
      }).catch(() => {});
    }
  });

  chrome.storage.onChanged.addListener(async (_c, area) => {
    if (area === 'local') sendConfig(derive(await chrome.storage.local.get(DEFAULTS)));
  });
})();