// Runs in the page's own context (world: MAIN) so it can intercept the
// page's calls. It has no chrome.* access; it talks to content.js through
// window.postMessage.
(() => {
  'use strict';
  if (window.__adshieldInstalled) return;
  Object.defineProperty(window, '__adshieldInstalled', { value: true });

  let enabled = true; // content.js turns this off for allowlisted sites
  let strict = true;  // strict redirect mode (popup toggle)

  /* ----- helpers ----- */

  const SLD = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.bd', 'net.bd', 'org.bd', 'edu.bd',
    'gov.bd', 'co.in', 'com.au', 'co.jp', 'co.nz', 'com.br', 'com.pk', 'co.za']);
  const regDomain = (h) => {
    const p = String(h).toLowerCase().split('.');
    if (p.length <= 2) return p.join('.');
    return SLD.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
  };

  // Login, payment and share destinations that normal sites send people to from a script.
  const TRUSTED = /(^|\.)(google\.com|googleapis\.com|gstatic\.com|apple\.com|microsoft\.com|live\.com|microsoftonline\.com|facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|github\.com|gitlab\.com|paypal\.com|stripe\.com|auth0\.com|okta\.com|whatsapp\.com|wa\.me|t\.me|telegram\.me|pinterest\.com|reddit\.com|youtube\.com|youtu\.be|bkash\.com|sslcommerz\.com|nagad\.com\.bd)$/i;

  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="menuitem"]';

  const report = (kind, url) => {
    let host = '';
    try { host = new URL(url, location.href).hostname; } catch (_) {}
    window.postMessage({ source: 'adshield-main', type: 'blocked', kind, host }, '*');
  };

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source === window && d && d.source === 'adshield-content' && d.type === 'config') {
      enabled = !!d.enabled;
      strict = d.strict !== false;
    }
  });
  window.postMessage({ source: 'adshield-main', type: 'ready' }, '*');

  /* ----- Remember the last real user click ----- */

  const COVER = 0.6;
  let last = { time: -1e9, suspicious: false, used: 0 };

  // An invisible, screen-sized layer sitting on top of the page is the classic click trap.
  function findOverlay(el) {
    for (let n = el; n instanceof Element && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      const r = n.getBoundingClientRect();
      if (r.width < innerWidth * COVER || r.height < innerHeight * COVER) continue;
      const invisible = parseFloat(cs.opacity) < 0.05;
      const noBackground = cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent';
      const empty = !n.textContent.trim() && !n.querySelector('img,video,canvas,svg,input,button');
      if (invisible || (noBackground && empty)) return n;
    }
    return null;
  }

  function noteClick(e, block) {
    if (!enabled || !e.isTrusted) return;
    const t = e.target;
    const isEl = t instanceof Element;
    const overlay = isEl ? findOverlay(t) : null;
    // In strict mode, a click on something that is not a link or control (a fake "Play" div, say)
    // is not allowed to open anything.
    const notAControl = strict && !(isEl && t.closest(INTERACTIVE));
    const suspicious = t === document.body || t === document.documentElement || !!overlay || notAControl;
    last = { time: performance.now(), suspicious, used: 0 };
    if (block && overlay) {
      e.stopImmediatePropagation();
      e.preventDefault();
      overlay.style.setProperty('display', 'none', 'important');
      report('overlay', '');
    }
  }
  document.addEventListener('mousedown', (e) => noteClick(e, false), true);
  document.addEventListener('click', (e) => noteClick(e, true), true);

  const fromRealClick = () => {
    const active = navigator.userActivation ? navigator.userActivation.isActive : true;
    return active && performance.now() - last.time < 1500 && !last.suspicious;
  };

  /* ----- window.open: pop-ups and pop-unders ----- */

  const nativeOpen = window.open;
  const fakeWindow = () => ({
    closed: true, close() {}, focus() {}, blur() {}, postMessage() {},
    location: { href: '', assign() {}, replace() {} },
    document: { write() {}, writeln() {}, close() {} }
  });

  function popupAllowed(url) {
    if (!fromRealClick() || last.used >= 1) return false;
    if (!strict) return true;
    // Strict: a pop-up may only go to the same site or a login / payment / share site.
    let u;
    try { u = new URL(url || '', location.href); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    return regDomain(u.hostname) === regDomain(location.hostname) || TRUSTED.test(u.hostname);
  }

  Object.defineProperty(window, 'open', {
    configurable: true,
    writable: true,
    value: function open(url, target) {
      if (!enabled || /^_(self|parent|top)$/i.test(target || '')) {
        return nativeOpen.apply(this, arguments);
      }
      if (popupAllowed(url)) {
        last.used += 1;
        return nativeOpen.apply(this, arguments);
      }
      report('popup', url);
      return fakeWindow();
    }
  });

  /* ----- Script-made clicks on links (a.click(), dispatchEvent) ----- */

  function scriptClickBlocked(a) {
    if (!enabled || a.hasAttribute('download') || /^(blob|data|javascript):/i.test(a.href)) return false;
    let host;
    try { host = new URL(a.href, location.href).hostname; } catch (_) { return false; }
    const cross = regDomain(host) !== regDomain(location.hostname);
    const newTab = (a.target || '').toLowerCase() === '_blank';
    if (!cross && !newTab) return false;
    if (!fromRealClick()) return true;
    return strict && cross && !TRUSTED.test(host);
  }

  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (scriptClickBlocked(this)) { report('hijack', this.href); return; }
    return nativeAnchorClick.apply(this, arguments);
  };

  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && !ev.isTrusted && this instanceof HTMLAnchorElement && scriptClickBlocked(this)) {
      report('hijack', this.href);
      return false;
    }
    return nativeDispatch.apply(this, arguments);
  };

  /* ----- Forced redirects (Navigation API, Chrome) ----- */

  if ('navigation' in window) {
    navigation.addEventListener('navigate', (e) => {
      // Real link clicks and form submits are userInitiated; script redirects are not.
      if (!enabled || !e.cancelable || e.userInitiated || e.hashChange || e.downloadRequest !== null) return;
      if (e.navigationType !== 'push' && e.navigationType !== 'replace') return;
      let dest;
      try { dest = new URL(e.destination.url); } catch (_) { return; }
      if (!/^https?:$/.test(dest.protocol)) return;
      if (regDomain(dest.hostname) === regDomain(location.hostname)) return;
      if (TRUSTED.test(dest.hostname)) return;
      if (!strict && (fromRealClick() || (navigator.userActivation && navigator.userActivation.isActive))) return;
      e.preventDefault();
      report('redirect', dest.href);
    });
  }
})();