(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const volumeSlider = $('volumeSlider');
  const volumeValue = $('volumeValue');
  const ringProgress = $('ringProgress');
  const sliderFill = $('sliderFill');
  const sliderGlow = $('sliderGlow');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const tabTitle = $('tabTitle');
  const tabDomain = $('tabDomain');
  const tabFavicon = $('tabFavicon');
  const tabFaviconFallback = $('tabFaviconFallback');
  const tabBadge = $('tabBadge');
  const resetBtn = $('resetBtn');

  const RING_CIRC = 2 * Math.PI * 82;
  const clamp = (n, lo, hi) => n < lo ? lo : n > hi ? hi : n;

  let currentTabId = null;
  let currentVolume = 100;

  // Ring offset cache — all 601 possible values precomputed at init (avoids per-frame math)
  const ringOffsets = new Array(601);
  for (let i = 0; i <= 600; i++) {
    ringOffsets[i] = RING_CIRC * (1 - i / 600);
  }

  // ── Apply volume (single codepath, no branching for badge) ──
  const applyVolumeNow = (v) => {
    if (currentTabId == null) return;
    const vol = v / 100;
    // Fire-and-forget: both message and storage write in parallel (independent)
    chrome.tabs.sendMessage(currentTabId, { action: 'setVolume', volume: vol }).catch(() => {});
    chrome.storage.local.set({ [`vol_${currentTabId}`]: v });
    // Badge: always send actual value, service worker handles display threshold
    chrome.runtime.sendMessage({ action: 'updateBadge', volume: vol }).catch(() => {});
  };

  // rAF-coalesced apply: at most one per frame
  let rafPending = 0;
  let pendingVolume = 0;

  const applyVolumeRAF = (v) => {
    pendingVolume = v;
    if (rafPending) return;
    rafPending = requestAnimationFrame(() => {
      rafPending = 0;
      applyVolumeNow(pendingVolume);
    });
  };

  // ── UI update (runs every frame during drag, but all writes are GPU-composited) ──
  const updateVolumeDisplay = (v) => {
    currentVolume = v;
    volumeValue.textContent = v;
    ringProgress.style.strokeDashoffset = ringOffsets[v];
    ringProgress.className = 'ring-progress ' + (
      v > 400 ? 'glow-red' : v > 200 ? 'glow-purple' : 'glow-blue'
    );
    volumeValue.className = 'volume-value' + (
      v > 400 ? ' color-red' : v > 200 ? ' color-purple' : v === 0 ? ' color-muted' : ''
    );
    tabBadge.textContent = v + '%';
    tabBadge.className = 'tab-volume-badge' + (
      v > 400 ? ' maxed' : v > 150 ? ' boosted' : ''
    );

    const scale = v / 600;
    sliderFill.style.transform = `scaleX(${scale})`;
    sliderGlow.style.transform = `scaleX(${scale})`;

    // Only update presets if value matches a preset (rare); skip full scan otherwise
    for (const btn of presetBtns) {
      btn.classList.toggle('active', +btn.dataset.value === v);
    }
  };

  // ── Slider: input is the only event needed (handles drag + arrow click) ──
  volumeSlider.addEventListener('input', () => {
    const v = +volumeSlider.value;
    updateVolumeDisplay(v);
    applyVolumeRAF(v);
  });

  // ── Presets ──
  for (const btn of presetBtns) {
    btn.addEventListener('click', () => {
      const v = +btn.dataset.value;
      volumeSlider.value = v;
      updateVolumeDisplay(v);
      // Presets: apply immediately, skip rAF queue + clear any pending
      if (rafPending) { cancelAnimationFrame(rafPending); rafPending = 0; }
      applyVolumeNow(v);
    });
  }

  // ── Reset All ──
  resetBtn.addEventListener('click', async () => {
    volumeSlider.value = 100;
    updateVolumeDisplay(100);
    if (rafPending) { cancelAnimationFrame(rafPending); rafPending = 0; }

    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(tab =>
      chrome.tabs.sendMessage(tab.id, { action: 'setVolume', volume: 1.0 })
        .then(() => chrome.storage.local.remove(`vol_${tab.id}`))
        .catch(() => {})
    ));
    chrome.runtime.sendMessage({ action: 'updateBadge', volume: 1.0 }).catch(() => {});
  });

  // ── Keyboard (rAF-coalesced like slider) ──
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const newV = clamp(currentVolume + (e.key === 'ArrowUp' ? 5 : -5), 0, 600);
    volumeSlider.value = newV;
    updateVolumeDisplay(newV);
    applyVolumeRAF(newV);
  });

  // ── Init ──
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    currentTabId = tab.id;

    tabTitle.textContent = tab.title || 'Unknown';
    try {
      tabDomain.textContent = new URL(tab.url).hostname.replace(/^www\./, '');
    } catch {
      tabDomain.textContent = '\u2014';
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

    const stored = await chrome.storage.local.get(`vol_${tab.id}`);
    const savedVol = stored[`vol_${tab.id}`] || 100;
    volumeSlider.value = savedVol;
    updateVolumeDisplay(savedVol);
    applyVolumeNow(savedVol);
  })();
})();
