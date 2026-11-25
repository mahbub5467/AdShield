'use strict';

const DEFAULTS = {
  enabled: true, blockNotifications: true, youtubeSkip: true, strictRedirects: true,
  allowlist: [], customBlocked: []
};
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const KIND = { redirect: 'Redirect', popup: 'Pop-up', hijack: 'Hijacked click', overlay: 'Overlay' };
const $ = (sel) => document.querySelector(sel);

let tab = null;
let host = '';

const covers = (list, h) => list.some((d) => h === d || h.endsWith('.' + d));

function siteHost(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : '';
  } catch (_) {
    return '';
  }
}

// Blocked requests on this tab: matched rules, or the toolbar badge count if that call is throttled.
async function networkCount(tabId) {
  let matched = 0;
  let badge = 0;
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    matched = rulesMatchedInfo.filter((r) => r.rule.rulesetId === 'ads').length;
  } catch (_) {}
  try {
    badge = parseInt(await chrome.action.getBadgeText({ tabId }), 10) || 0;
  } catch (_) {}
  return Math.max(matched, badge);
}

async function pageData(tabId) {
  const net = await networkCount(tabId);
  const got = await chrome.storage.session.get(`counts:${tabId}`);
  const c = got[`counts:${tabId}`] || {};
  const dom = Object.values(c.cosmetic || {}).reduce((a, b) => a + b, 0);
  return { net, dom, hij: c.hijacks || 0, yt: c.youtube || 0, events: c.events || [] };
}

function renderCounts(c) {
  const total = c.net + c.dom + c.hij + c.yt;
  $('#total').textContent = total.toLocaleString();
  for (const k of ['net', 'dom', 'hij', 'yt']) {
    $(`#n-${k}`).textContent = c[k].toLocaleString();
    $(`#seg-${k}`).style.flexGrow = String(c[k]);
  }
}

const getSettings = () => chrome.storage.local.get(DEFAULTS);

async function addBlockedDomain(raw) {
  let h = String(raw).trim().toLowerCase();
  if (!h) return 'Enter a domain such as example.com.';
  try { h = new URL(h.includes('://') ? h : `http://${h}`).hostname; } catch (_) { return 'That is not a valid domain.'; }
  h = h.replace(/^www\./, '');
  if (!DOMAIN_RE.test(h)) return 'That is not a valid domain.';
  if (host && (h === host || host.endsWith('.' + h))) return "You can't block the site you are on.";
  const { customBlocked } = await getSettings();
  if (!customBlocked.includes(h)) await chrome.storage.local.set({ customBlocked: [...customBlocked, h] });
  return '';
}

function renderAttempts(events, custom) {
  const rows = events.filter((e) => e.host);
  $('#attempts-wrap').hidden = rows.length === 0;
  const ul = $('#attempts');
  ul.replaceChildren();
  for (const ev of rows) {
    const li = document.createElement('li');
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = KIND[ev.kind] || ev.kind;
    const dom = document.createElement('span');
    dom.className = 'dom';
    dom.textContent = ev.host;
    const btn = document.createElement('button');
    btn.type = 'button';
    const done = covers(custom, ev.host);
    btn.textContent = done ? 'Blocked' : 'Block';
    btn.disabled = done;
    btn.addEventListener('click', async () => {
      const err = await addBlockedDomain(ev.host);
      if (!err) {
        btn.textContent = 'Blocked';
        btn.disabled = true;
        renderCustom();
      }
    });
    li.append(kind, dom, btn);
    ul.append(li);
  }
}

async function renderCustom() {
  const { customBlocked } = await getSettings();
  const ul = $('#custom-list');
  ul.replaceChildren();
  for (const d of customBlocked) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'dom';
    name.textContent = d;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'remove';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove ${d}`);
    rm.addEventListener('click', async () => {
      const s = await getSettings();
      await chrome.storage.local.set({ customBlocked: s.customBlocked.filter((x) => x !== d) });
      renderCustom();
    });
    li.append(name, rm);
    ul.append(li);
  }
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  host = tab ? siteHost(tab.url) : '';
  const s = await getSettings();

  $('#host').textContent = host || 'No website open';
  $('#master').checked = s.enabled;
  $('#notif').checked = s.blockNotifications;
  $('#yt').checked = s.youtubeSkip;
  $('#strict').checked = s.strictRedirects;
  $('#site').checked = !covers(s.allowlist, host);

  if (!host) {
    $('#site').disabled = true;
    $('#note').hidden = false;
  } else {
    const data = await pageData(tab.id);
    renderCounts(data);
    renderAttempts(data.events, s.customBlocked);
  }
  renderCustom();

  const reload = () => { if (tab && host) chrome.tabs.reload(tab.id); };
  const save = (patch) => chrome.storage.local.set(patch);

  $('#master').addEventListener('change', async (e) => { await save({ enabled: e.target.checked }); reload(); });
  $('#notif').addEventListener('change', (e) => save({ blockNotifications: e.target.checked }));
  $('#yt').addEventListener('change', async (e) => { await save({ youtubeSkip: e.target.checked }); reload(); });
  $('#strict').addEventListener('change', async (e) => { await save({ strictRedirects: e.target.checked }); reload(); });

  $('#site').addEventListener('change', async (e) => {
    const { allowlist } = await getSettings();
    const rest = allowlist.filter((d) => !(host === d || host.endsWith('.' + d)));
    await save({ allowlist: e.target.checked ? rest : [...rest, host] });
    reload();
  });

  const submit = async () => {
    const input = $('#domain');
    const err = await addBlockedDomain(input.value);
    $('#msg').hidden = !err;
    $('#msg').textContent = err;
    if (!err) { input.value = ''; renderCustom(); }
  };
  $('#add').addEventListener('click', submit);
  $('#domain').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

init();