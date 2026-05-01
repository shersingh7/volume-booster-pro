// ── Service Worker: Volume Booster Pro ──

// Clean up stored volumes for closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`vol_${tabId}`);
});

// Badge updates from content script
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action !== 'updateBadge' || !sender.tab) return;

  const tabId = sender.tab.id;
  const vol = Math.round(request.volume * 100);

  if (vol === 100) {
    chrome.action.setBadgeText({ text: '', tabId });
  } else {
    chrome.action.setBadgeText({ text: vol + '%', tabId });
    chrome.action.setBadgeBackgroundColor({
      color: vol > 400 ? '#f87171' : vol > 200 ? '#a78bfa' : '#60a5fa',
      tabId,
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Volume Booster Pro] Installed');
});
