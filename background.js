// ── Service Worker ──

// Clean up stored volumes for closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`vol_${tabId}`);
});

// Reset volume when navigating to a new page (optional behavior)
// Uncomment below if you want per-site persistence instead of per-tab
/*
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    // Keep volume as-is or reset
  }
});
*/

// Handle icon badge showing current boost level
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateBadge' && sender.tab) {
    const vol = Math.round(request.volume * 100);
    if (vol === 100) {
      chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
    } else {
      chrome.action.setBadgeText({ text: `${vol}%`, tabId: sender.tab.id });
      const color = vol > 400 ? '#f87171' : vol > 200 ? '#a78bfa' : '#60a5fa';
      chrome.action.setBadgeBackgroundColor({ color: color, tabId: sender.tab.id });
    }
  }
});

// Context menu for quick access (optional)
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Volume Booster Pro] Installed');
});
