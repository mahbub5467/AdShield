// Cosmetic filtering: hides ad containers with injected CSS, and watches for
// overlays and floating ads that appear later.
(() => {
  'use strict';

  const SELECTORS = [
    'ins.adsbygoogle', '.adsbygoogle', '[id^="div-gpt-ad"]', '[id^="google_ads_iframe"]', '[id*="google_ads"]',
    '[data-ad-slot]', '[data-ad-client]', '[aria-label="Advertisement"]', '[aria-label="advertisement"]',
    '.ad-banner', '.ad-container', '.ad-wrapper', '.advertisement', '.advert', '.banner-ads',
    '.sticky-ad', '.floating-ad', '.ad-overlay', '.ad-popup', '#ad-banner', '#ad_banner',
    'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]', 'iframe[src*="adservice.google"]',
    'iframe[src*="taboola.com"]', 'iframe[src*="outbrain.com"]'
  ];
  const SELECTOR = SELECTORS.join(',');

  const AD_WORD = /(^|[\s_-])(ad|ads|adv|advert|advertisement|adslot|sponsored|interstitial)([\s_-]|$)/i;
  const AD_HOST = /doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|taboola\.com|outbrain\.com|popads\.net|propellerads\.com|adsterra\.com|exoclick\.com/i;

  const hidden = new WeakSet();
  let hiddenCount = 0;
  let lastSent = -1;

  function injectStyle() {
    const style = document.createElement('style');
    style.id = 'adshield-style';
    style.textContent = `${SELECTOR}{display:none !important}`;
    (document.head || document.documentElement).appendChild(style);
  }

  const hasAdSignature = (el) => {
    const label = `${el.id || ''} ${el.getAttribute('class') || ''}`;
    if (AD_WORD.test(label)) return true;
    const frame = el.tagName === 'IFRAME' ? el : el.querySelector('iframe[src]');
    return !!(frame && AD_HOST.test(frame.src));
  };

  function hide(el) {
    el.style.setProperty('display', 'none', 'important');
    hidden.add(el);
    hiddenCount += 1;
  }

  function evaluate(el) {
    if (!(el instanceof HTMLElement) || hidden.has(el) || el.id === 'adshield-style') return;
    const cs = getComputedStyle(el);
    if ((cs.position !== 'fixed' && cs.position !== 'sticky') || cs.display === 'none') return;

    const r = el.getBoundingClientRect();
    const coversMost = r.width >= innerWidth * 0.6 && r.height >= innerHeight * 0.6;
    const transparent = cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent';
    const empty = !el.textContent.trim() && !el.querySelector('img,video,canvas,svg,input,button');

    // Invisible click-trap layer over the whole page.
    if (coversMost && (parseFloat(cs.opacity) < 0.05 || (transparent && empty))) return hide(el);
    // Fixed or sticky element that looks like an ad.
    if (hasAdSignature(el) && !el.querySelector('video')) hide(el);
  }

  const evaluateWithChildren = (el) => {
    evaluate(el);
    if (el.children) for (const c of el.children) evaluate(c);
  };

  function report() {
    const n = document.querySelectorAll(SELECTOR).length + hiddenCount;
    if (n === lastSent) return;
    lastSent = n;
    chrome.runtime.sendMessage({ type: 'cosmetic', count: n }).catch(() => {});
  }

  function start() {
    injectStyle();

    let pending = new Set();
    let timer = 0;
    const flush = () => {
      timer = 0;
      const batch = pending;
      pending = new Set();
      batch.forEach((el) => { if (el.isConnected) evaluateWithChildren(el); });
      report();
    };

    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) if (node.nodeType === 1) pending.add(node);
      }
      if (pending.size && !timer) timer = setTimeout(flush, 120);
    }).observe(document.documentElement, { childList: true, subtree: true });

    const scanBody = () => {
      if (document.body) for (const c of document.body.children) evaluateWithChildren(c);
      report();
    };
    document.addEventListener('DOMContentLoaded', scanBody);
    window.addEventListener('load', () => { scanBody(); setTimeout(scanBody, 3000); });
  }

  __adshield.settings.then((s) => { if (s.active) start(); });
})();
