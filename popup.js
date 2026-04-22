(() => {
  // ── Elements ──
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  const ringProgress = document.getElementById('ringProgress');
  const sliderFill = document.getElementById('sliderFill');
  const sliderGlow = document.getElementById('sliderGlow');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const tabTitle = document.getElementById('tabTitle');
  const tabDomain = document.getElementById('tabDomain');
  const tabFavicon = document.getElementById('tabFavicon');
  const tabFaviconFallback = document.getElementById('tabFaviconFallback');
  const tabBadge = document.getElementById('tabBadge');
  const resetBtn = document.getElementById('resetBtn');

  const RING_CIRCUMFERENCE = 2 * Math.PI * 82; // ~515.22

  // ── State ──
  let currentTabId = null;
  let currentVolume = 100;

  // ── Helpers ──
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  const getColorForVolume = (v) => {
    if (v <= 100) return 'var(--ring-normal)';
    if (v <= 250) return 'var(--ring-boost)';
    return 'var(--ring-max)';
  };

  const updateRing = (v) => {
    const pct = clamp(v / 600, 0, 1);
    const offset = RING_CIRCUMFERENCE * (1 - pct);
    ringProgress.style.strokeDashoffset = offset;

    // Dynamic color shift
    if (v > 400) {
      ringProgress.style.filter = 'drop-shadow(0 0 8px rgba(248,113,113,0.5))';
    } else if (v > 200) {
      ringProgress.style.filter = 'drop-shadow(0 0 8px rgba(167,139,250,0.4))';
    } else {
      ringProgress.style.filter = 'drop-shadow(0 0 6px rgba(96,165,250,0.3))';
    }
  };

  const updateSliderFill = (v) => {
    const pct = (v / 600) * 100;
    sliderFill.style.width = pct + '%';
    sliderGlow.style.width = pct + '%';
  };

  const updateBadge = (v) => {
    tabBadge.textContent = v + '%';
    tabBadge.classList.remove('boosted', 'maxed');
    if (v > 400) tabBadge.classList.add('maxed');
    else if (v > 150) tabBadge.classList.add('boosted');
  };

  const updateVolumeDisplay = (v, skipSlider = false) => {
    currentVolume = v;
    volumeValue.textContent = v;
    updateRing(v);
    updateSliderFill(v);
    updateBadge(v);

    if (!skipSlider) {
      volumeSlider.value = v;
    }

    // Update preset active state
    presetBtns.forEach(btn => {
      const val = parseInt(btn.dataset.value);
      btn.classList.remove('active');
      if (val === v) btn.classList.add('active');
    });

    // Value color
    if (v > 400) volumeValue.style.color = 'var(--accent-red)';
    else if (v > 200) volumeValue.style.color = 'var(--accent-purple)';
    else if (v === 0) volumeValue.style.color = 'var(--text-muted)';
    else volumeValue.style.color = 'var(--text-primary)';
  };

  // ── Apply Volume to Page ──
  const applyVolume = async (tabId, volume) => {
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'setVolume',
        volume: volume / 100
      });
      // Persist per-tab
      await chrome.storage.local.set({ [`vol_${tabId}`]: volume });
    } catch (err) {
      // Tab may not have content script injected yet
      console.log('Volume apply failed:', err);
    }
  };

  // ── Event Listeners ──
  volumeSlider.addEventListener('input', (e) => {
    const v = parseInt(e.target.value);
    updateVolumeDisplay(v, true);
    if (currentTabId !== null) {
      applyVolume(currentTabId, v);
    }
  });

  volumeSlider.addEventListener('change', (e) => {
    const v = parseInt(e.target.value);
    updateVolumeDisplay(v, true);
    if (currentTabId !== null) {
      applyVolume(currentTabId, v);
    }
  });

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const v = parseInt(btn.dataset.value);
      updateVolumeDisplay(v);
      if (currentTabId !== null) {
        applyVolume(currentTabId, v);
      }
    });
  });

  resetBtn.addEventListener('click', async () => {
    updateVolumeDisplay(100);
    if (currentTabId !== null) {
      await applyVolume(currentTabId, 100);
    }
    // Reset all tabs
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'setVolume', volume: 1.0 });
        await chrome.storage.local.remove(`vol_${tab.id}`);
      } catch (_) {}
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newV = clamp(currentVolume + 5, 0, 600);
      updateVolumeDisplay(newV);
      if (currentTabId !== null) applyVolume(currentTabId, newV);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newV = clamp(currentVolume - 5, 0, 600);
      updateVolumeDisplay(newV);
      if (currentTabId !== null) applyVolume(currentTabId, newV);
    }
  });

  // ── Init ──
  const init = async () => {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentTabId = tab.id;

    // Tab info
    tabTitle.textContent = tab.title || 'Unknown';
    try {
      const url = new URL(tab.url);
      tabDomain.textContent = url.hostname.replace(/^www\./, '');
    } catch {
      tabDomain.textContent = '—';
    }

    if (tab.favIconUrl) {
      tabFavicon.src = tab.favIconUrl;
      tabFavicon.onerror = () => {
        tabFavicon.style.display = 'none';
        tabFaviconFallback.style.display = 'flex';
      };
    } else {
      tabFavicon.style.display = 'none';
      tabFaviconFallback.style.display = 'flex';
    }

    // Load saved volume for this tab
    const stored = await chrome.storage.local.get(`vol_${tab.id}`);
    const savedVol = stored[`vol_${tab.id}`] || 100;
    updateVolumeDisplay(savedVol);

    // Apply on open (in case page was refreshed)
    applyVolume(tab.id, savedVol);
  };

  init();
})();
