// Service worker: badge updates + storage cleanup for closed tabs.

function storageKey(tabId) {
  return `vol_${tabId}`;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(storageKey(tabId));
});

/**
 * Update the action badge for a tab from a trusted successful apply path.
 * volumePercent is 0–600.
 */
async function setBadgeForTab(tabId, volumePercent) {
  if (tabId == null) return;
  const v = Math.round(Number(volumePercent));
  if (!Number.isFinite(v)) return;

  if (v === 100) {
    await chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  const text = v === 0 ? 'MUTE' : String(v);
  await chrome.action.setBadgeText({ text, tabId });

  let color = '#60a5fa';
  if (v === 0) color = '#64748b';
  else if (v > 400) color = '#f87171';
  else if (v > 200) color = '#a78bfa';

  await chrome.action.setBadgeBackgroundColor({ color, tabId });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== 'object') {
    sendResponse({ ok: false });
    return false;
  }

  if (request.action === 'updateBadge') {
    const tabId =
      request.tabId != null
        ? request.tabId
        : sender.tab && sender.tab.id != null
          ? sender.tab.id
          : null;

    // Prefer explicit percent; fall back to gain * 100 from legacy callers
    let percent = request.volumePercent;
    if (percent == null && request.volume != null) {
      percent = Math.round(Number(request.volume) * 100);
    }

    if (tabId == null) {
      sendResponse({ ok: false });
      return false;
    }

    setBadgeForTab(tabId, percent)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  // Quiet install; no console noise in production paths.
});
