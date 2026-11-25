'use strict';

const DEFAULTS = {
  enabled: true, blockNotifications: true, youtubeSkip: true, strictRedirects: true,
  allowlist: [], customBlocked: []
};
const BLOCKED_PAGE = chrome.runtime.getURL('pages/blocked.html');
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const SUBRESOURCES = ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping', 'media', 'other'];

// Service workers are killed when idle, so nothing lives in variables except
// this queue, which only keeps concurrent writes in order.
let chain = Promise.resolve();
const enqueue = (fn) => {
  chain = chain.then(fn).catch((e) => console.error('[AdShield]', e));
  return chain;
};

const getSettings = () => chrome.storage.local.get(DEFAULTS);

/* ---------- Applying settings ---------- */

async function applyNotificationPolicy(s) {
  const cs = chrome.contentSettings && chrome.contentSettings.notifications;
  if (!cs) return;
  await cs.clear({});
  if (!(s.enabled && s.blockNotifications)) return;
  await cs.set({ primaryPattern: '<all_urls>', setting: 'block' });
  // Allowlisted sites get the normal browser prompt back.
  for (const host of s.allowlist) {
    await cs.set({ primaryPattern: `*://${host}/*`, setting: 'ask' });
    await cs.set({ primaryPattern: `*://*.${host}/*`, setting: 'ask' });
  }
}

async function syncState() {
  const s = await getSettings();

  await chrome.declarativeNetRequest.updateEnabledRulesets(
    s.enabled ? { enableRulesetIds: ['ads'] } : { disableRulesetIds: ['ads'] }
  );
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  await chrome.action.setBadgeBackgroundColor({ color: '#0B7A5E' });

  // Allowlisted sites: ids 1..N, above every block rule.
  const addRules = s.allowlist.map((host, i) => ({
    id: i + 1,
    priority: 100,
    action: { type: 'allowAllRequests' },
    condition: { requestDomains: [host], resourceTypes: ['main_frame', 'sub_frame'] }
  }));

  // The person's own blocked domains: ids 1000 and 1001.
  const custom = s.enabled ? s.customBlocked.filter((d) => DOMAIN_RE.test(d)) : [];
  if (custom.length) {
    addRules.push(
      { id: 1000, priority: 50, action: { type: 'block' },
        condition: { requestDomains: custom, resourceTypes: SUBRESOURCES } },
      { id: 1001, priority: 50,
        action: { type: 'redirect', redirect: { extensionPath: '/pages/blocked.html' } },
        condition: { requestDomains: custom, resourceTypes: ['main_frame'] } }
    );
  }

  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules
  });

  await applyNotificationPolicy(s);
}

chrome.runtime.onInstalled.addListener(() => {
  enqueue(async () => {
    await chrome.storage.local.set(await getSettings()); // writes defaults for missing keys
    await syncState();
  });
});
chrome.runtime.onStartup.addListener(() => enqueue(syncState));
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') enqueue(syncState);
});

/* ---------- Per-tab counters and recent attempts (session storage) ---------- */

const countsKey = (tabId) => `counts:${tabId}`;

async function updateCounts(tabId, mutate) {
  const k = countsKey(tabId);
  const got = await chrome.storage.session.get(k);
  const c = got[k] || {};
  c.cosmetic = c.cosmetic || {};
  c.hijacks = c.hijacks || 0;
  c.youtube = c.youtube || 0;
  c.events = c.events || [];
  mutate(c);
  await chrome.storage.session.set({ [k]: c });
}

function recordEvent(c, kind, host) {
  if (!host || c.events.some((e) => e.kind === kind && e.host === host)) return;
  c.events.unshift({ kind, host });
  c.events.length = Math.min(c.events.length, 8);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || !msg) return;

  if (msg.type === 'cosmetic') {
    const n = Math.max(0, Math.min(5000, Number(msg.count) || 0));
    enqueue(() => updateCounts(tabId, (c) => { c.cosmetic[sender.frameId] = n; }));
  } else if (msg.type === 'blocked') {
    enqueue(() => updateCounts(tabId, (c) => {
      if (msg.kind === 'youtube') {
        c.youtube += 1;
      } else {
        c.hijacks += 1;
        recordEvent(c, String(msg.kind), String(msg.host || ''));
      }
    }));
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // New page load: start the counters from zero.
  if (info.status === 'loading') {
    enqueue(() => chrome.storage.session.remove(countsKey(tabId)));
  }

  // A pop-up / pop-under tab that was redirected to our blocked page:
  // close it and credit the tab that opened it.
  if (info.url && info.url.startsWith(BLOCKED_PAGE) && tab.openerTabId != null) {
    const opener = tab.openerTabId;
    enqueue(() => updateCounts(opener, (c) => { c.hijacks += 1; }));
    chrome.tabs.remove(tabId).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => chrome.storage.session.remove(countsKey(tabId)));
});