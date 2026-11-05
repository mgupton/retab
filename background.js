const historyByWindow = new Map();
const cycles = new Map();
const CYCLE_TIMEOUT_MS = 1200;
let programmaticActivations = new Set();

function touch(windowId, tabId) {
  const ids = historyByWindow.get(windowId) || [];
  historyByWindow.set(windowId, [tabId, ...ids.filter(id => id !== tabId)]);
}

async function seedWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const ordered = [...tabs]
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .map(t => t.id);
  historyByWindow.set(windowId, ordered);
  return tabs;
}

async function validHistory(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const valid = new Set(tabs.map(t => t.id));
  let ids = (historyByWindow.get(windowId) || []).filter(id => valid.has(id));
  for (const t of tabs) if (!ids.includes(t.id)) ids.push(t.id);
  historyByWindow.set(windowId, ids);
  return { tabs, ids };
}

function expireCycle(windowId) {
  const c = cycles.get(windowId);
  if (c?.timer) clearTimeout(c.timer);
  cycles.delete(windowId);
}

function armExpiry(windowId) {
  const c = cycles.get(windowId);
  if (!c) return;
  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => expireCycle(windowId), CYCLE_TIMEOUT_MS);
}

async function cycle(direction) {
  const win = await chrome.windows.getLastFocused({ populate: false });
  if (!win || win.id === chrome.windows.WINDOW_ID_NONE) return;
  const windowId = win.id;
  const { tabs, ids } = await validHistory(windowId);
  const active = tabs.find(t => t.active);
  if (!active || ids.length < 2) return;

  let c = cycles.get(windowId);
  if (!c) {
    // Freeze MRU order at the start of a key sequence. This is the crucial
    // difference from v1: tabs activated by cycling do not reshuffle the list.
    const snapshot = [active.id, ...ids.filter(id => id !== active.id)];
    c = { snapshot, index: 0, timer: null };
    cycles.set(windowId, c);
  } else {
    // Drop tabs that were closed while cycling.
    const valid = new Set(tabs.map(t => t.id));
    c.snapshot = c.snapshot.filter(id => valid.has(id));
    if (!c.snapshot.length) { expireCycle(windowId); return; }
    c.index = Math.min(c.index, c.snapshot.length - 1);
  }

  const delta = direction === "forward" ? 1 : -1;
  c.index = (c.index + delta + c.snapshot.length) % c.snapshot.length;
  const targetId = c.snapshot[c.index];

  programmaticActivations.add(targetId);
  await chrome.tabs.update(targetId, { active: true });
  armExpiry(windowId);
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (programmaticActivations.delete(tabId)) return;
  // A real click/keyboard/browser activation ends the current cycle and is a
  // genuine MRU visit.
  expireCycle(windowId);
  touch(windowId, tabId);
});

chrome.tabs.onRemoved.addListener((tabId, { windowId }) => {
  historyByWindow.set(windowId, (historyByWindow.get(windowId) || []).filter(id => id !== tabId));
  const c = cycles.get(windowId);
  if (c) c.snapshot = c.snapshot.filter(id => id !== tabId);
});

chrome.tabs.onAttached.addListener((tabId, { newWindowId }) => {
  expireCycle(newWindowId);
  touch(newWindowId, tabId);
});

chrome.windows.onRemoved.addListener(windowId => {
  historyByWindow.delete(windowId);
  expireCycle(windowId);
});

chrome.commands.onCommand.addListener(command => {
  if (command === "mru-forward") void cycle("forward");
  if (command === "mru-backward") void cycle("backward");
});

chrome.runtime.onInstalled.addListener(async () => {
  const wins = await chrome.windows.getAll({ populate: false });
  for (const w of wins) await seedWindow(w.id);
});

chrome.runtime.onStartup.addListener(async () => {
  const wins = await chrome.windows.getAll({ populate: false });
  for (const w of wins) await seedWindow(w.id);
});
