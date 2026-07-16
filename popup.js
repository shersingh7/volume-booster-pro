(() => {
  'use strict';

  const VU = globalThis.VolumeUtils;
  if (!VU) {
    throw new Error('VolumeUtils failed to load');
  }

  const RING_C = 2 * Math.PI * 32;

  const app = document.getElementById('app');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  const ringProgress = document.getElementById('ringProgress');
  const sliderFill = document.getElementById('sliderFill');
  const presetBtns = Array.from(document.querySelectorAll('.preset-btn'));
  const tabTitle = document.getElementById('tabTitle');
  const tabDomain = document.getElementById('tabDomain');
  const tabFavicon = document.getElementById('tabFavicon');
  const tabFaviconFallback = document.getElementById('tabFaviconFallback');
  const resetBtn = document.getElementById('resetBtn');
  const statusLabel = document.getElementById('statusLabel');
  const statusDetail = document.getElementById('statusDetail');
  const highBoostWarning = document.getElementById('highBoostWarning');

  /** Displayed volume (may be pending) */
  let displayVolume = VU.NORMAL_PERCENT;
  /** Last volume confirmed applied by content script */
  let confirmedVolume = VU.NORMAL_PERCENT;
  let currentTabId = null;
  let controlsEnabled = true;
  let applySeq = 0;
  let rafPending = null;
  let pendingApplyVolume = null;
  let storageTimer = null;
  let latestDesiredVolume = VU.NORMAL_PERCENT;

  function setControlsEnabled(enabled) {
    controlsEnabled = enabled;
    app.classList.toggle('controls-disabled', !enabled);
    volumeSlider.disabled = !enabled;
    resetBtn.disabled = !enabled;
    presetBtns.forEach((btn) => {
      btn.disabled = !enabled;
    });
  }

  function setOperationalState(state, label, detail) {
    app.dataset.state = state;
    statusLabel.textContent = label;
    statusDetail.textContent = detail || '';
  }

  function renderVolume(percent, { skipSlider = false } = {}) {
    const v = VU.normalizePercent(percent);
    displayVolume = v;
    latestDesiredVolume = v;

    volumeValue.textContent = String(v);

    const fraction = VU.percentToSliderFraction(v);
    sliderFill.style.transform = 'scaleX(' + fraction + ')';

    const offset = RING_C * (1 - fraction);
    ringProgress.style.strokeDashoffset = String(offset);

    app.dataset.band = VU.getVolumeBand(v);

    if (!skipSlider) {
      volumeSlider.value = String(v);
    }

    volumeSlider.setAttribute('aria-valuenow', String(v));
    volumeSlider.setAttribute('aria-valuetext', VU.formatValueText(v));

    presetBtns.forEach((btn) => {
      const val = VU.normalizePercent(btn.dataset.value);
      const active = val === v;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    highBoostWarning.hidden = !VU.shouldShowHighBoostWarning(v);
  }

  function isNoReceiverError(err) {
    const msg = err && (err.message || String(err));
    if (!msg) return false;
    return (
      /receiving end does not exist/i.test(msg) ||
      /could not establish connection/i.test(msg) ||
      /message port closed/i.test(msg)
    );
  }

  async function sendToTab(tabId, message) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return { ok: true, response };
    } catch (err) {
      return {
        ok: false,
        error: err,
        noReceiver: isNoReceiverError(err)
      };
    }
  }

  async function updateBadge(tabId, percent) {
    try {
      await chrome.runtime.sendMessage({
        action: 'updateBadge',
        tabId,
        volumePercent: percent
      });
    } catch (_) {
      // Badge is best-effort
    }
  }

  function scheduleStorageWrite(tabId, percent) {
    if (storageTimer) clearTimeout(storageTimer);
    storageTimer = setTimeout(() => {
      storageTimer = null;
      chrome.storage.local.set({ [`vol_${tabId}`]: percent }).catch(() => {});
    }, 160);
  }

  function flushStorage(tabId, percent) {
    if (storageTimer) {
      clearTimeout(storageTimer);
      storageTimer = null;
    }
    return chrome.storage.local.set({ [`vol_${tabId}`]: percent }).catch(() => {});
  }

  function cancelPendingStorageWrite() {
    if (storageTimer) {
      clearTimeout(storageTimer);
      storageTimer = null;
    }
  }

  async function applyVolume(tabId, percent, { persist = true, fromUser = true } = {}) {
    if (tabId == null || !controlsEnabled) return null;

    const v = VU.normalizePercent(percent);
    const seq = ++applySeq;
    const gain = VU.percentToGain(v);

    const result = await sendToTab(tabId, { action: 'setVolume', volume: gain });

    // Ignore stale responses
    if (seq !== applySeq) return null;

    if (!result.ok) {
      const detail = result.noReceiver
        ? 'Content script is not available on this page. Try reloading the tab.'
        : 'Could not reach the page. Reload the tab and try again.';
      setOperationalState('error', 'Error', detail);
      // Revert display to last confirmed if user gesture failed
      if (fromUser) {
        renderVolume(confirmedVolume);
      }
      return null;
    }

    const res = result.response || {};
    if (res.ok === false) {
      const classified = VU.classifyStatus(res);
      setOperationalState(classified.state, classified.label, classified.detail);
      if (fromUser) {
        renderVolume(confirmedVolume);
      }
      return res;
    }

    confirmedVolume = v;
    const classified = VU.classifyStatus(res);
    setOperationalState(classified.state, classified.label, classified.detail);

    // Persist and badge only after content confirmed success
    if (persist) {
      scheduleStorageWrite(tabId, v);
    }
    await updateBadge(tabId, v);
    return res;
  }

  function queueApply(percent) {
    pendingApplyVolume = VU.normalizePercent(percent);
    if (rafPending != null) return;
    rafPending = requestAnimationFrame(() => {
      rafPending = null;
      const v = pendingApplyVolume;
      pendingApplyVolume = null;
      if (currentTabId != null && v != null) {
        applyVolume(currentTabId, v, { persist: true, fromUser: true });
      }
    });
  }

  function onSliderInput(e) {
    if (!controlsEnabled) return;
    const v = VU.normalizePercent(e.target.value);
    renderVolume(v, { skipSlider: true });
    queueApply(v);
  }

  function onSliderChange(e) {
    if (!controlsEnabled || currentTabId == null) return;
    const v = VU.normalizePercent(e.target.value);
    renderVolume(v, { skipSlider: true });
    // Flush final value: cancel coalesced frame and apply + persist immediately
    if (rafPending != null) {
      cancelAnimationFrame(rafPending);
      rafPending = null;
      pendingApplyVolume = null;
    }
    applyVolume(currentTabId, v, { persist: true, fromUser: true }).then((res) => {
      // Only persist the requested value after a confirmed successful apply
      if (!VU.isApplySuccess(res)) return;
      flushStorage(currentTabId, confirmedVolume);
    });
  }

  volumeSlider.addEventListener('input', onSliderInput);
  volumeSlider.addEventListener('change', onSliderChange);

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!controlsEnabled || currentTabId == null) return;
      const v = VU.normalizePercent(btn.dataset.value);
      renderVolume(v);
      if (rafPending != null) {
        cancelAnimationFrame(rafPending);
        rafPending = null;
        pendingApplyVolume = null;
      }
      applyVolume(currentTabId, v, { persist: true, fromUser: true }).then((res) => {
        if (!VU.isApplySuccess(res)) return;
        flushStorage(currentTabId, confirmedVolume);
      });
    });
  });

  resetBtn.addEventListener('click', () => {
    if (!controlsEnabled || currentTabId == null) return;
    const v = VU.NORMAL_PERCENT;
    renderVolume(v);
    if (rafPending != null) {
      cancelAnimationFrame(rafPending);
      rafPending = null;
      pendingApplyVolume = null;
    }
    // persist:false — only clear storage/badge after confirmed success (avoid debounce race)
    applyVolume(currentTabId, v, { persist: false, fromUser: true }).then(async (res) => {
      if (!VU.isApplySuccess(res)) return;
      cancelPendingStorageWrite();
      try {
        await chrome.storage.local.remove(`vol_${currentTabId}`);
        await updateBadge(currentTabId, VU.NORMAL_PERCENT);
      } catch (_) {
        /* ignore */
      }
    });
  });

  // Keyboard: only when focus is not already on the range (range has native arrows)
  document.addEventListener('keydown', (e) => {
    if (!controlsEnabled || currentTabId == null) return;
    if (e.target === volumeSlider) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? 5 : -5;
    const newV = VU.clamp(latestDesiredVolume + delta, VU.MIN_PERCENT, VU.MAX_PERCENT);
    renderVolume(newV);
    queueApply(newV);
  });

  function showFavicon(url) {
    if (!url) {
      tabFavicon.hidden = true;
      tabFavicon.removeAttribute('src');
      tabFaviconFallback.hidden = false;
      return;
    }
    tabFaviconFallback.hidden = true;
    tabFavicon.hidden = false;
    tabFavicon.alt = '';
    tabFavicon.onload = () => {
      tabFavicon.hidden = false;
      tabFaviconFallback.hidden = true;
    };
    tabFavicon.onerror = () => {
      tabFavicon.hidden = true;
      tabFavicon.removeAttribute('src');
      tabFaviconFallback.hidden = false;
    };
    tabFavicon.src = url;
  }

  async function probeStatus(tabId) {
    const result = await sendToTab(tabId, { action: 'getStatus' });
    if (!result.ok) {
      if (result.noReceiver) {
        setOperationalState(
          'unavailable',
          'Unavailable on this page',
          'No content script on this page. Restricted pages and some internal Chrome pages cannot be controlled. Reload after installing the extension.'
        );
        setControlsEnabled(false);
        return null;
      }
      setOperationalState('error', 'Error', 'Failed to query page status.');
      return null;
    }
    return result.response;
  }

  async function init() {
    setOperationalState('loading', 'Loading', 'Checking this tab…');
    setControlsEnabled(false);
    renderVolume(VU.NORMAL_PERCENT);

    let tab;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
    } catch (_) {
      setOperationalState('error', 'Error', 'Could not read the active tab.');
      return;
    }

    if (!tab || tab.id == null) {
      setOperationalState('unavailable', 'Unavailable on this page', 'No active tab found.');
      return;
    }

    currentTabId = tab.id;
    tabTitle.textContent = tab.title || 'Unknown page';

    try {
      if (tab.url) {
        const url = new URL(tab.url);
        tabDomain.textContent = url.hostname
          ? url.hostname.replace(/^www\./, '')
          : url.protocol.replace(':', '');
      } else {
        tabDomain.textContent = '—';
      }
    } catch {
      tabDomain.textContent = tab.url || '—';
    }

    showFavicon(tab.favIconUrl);

    if (VU.isRestrictedUrl(tab.url) || tab.discarded) {
      const detail = tab.discarded
        ? 'This tab is discarded. Activate the page, then reopen the popup.'
        : 'Chrome internal pages, the Web Store, and similar URLs cannot run content scripts.';
      setOperationalState('unavailable', 'Unavailable on this page', detail);
      setControlsEnabled(false);

      // Still show any stored preference without claiming it is active
      try {
        const stored = await chrome.storage.local.get(`vol_${tab.id}`);
        const saved = VU.resolveStoredPercent(stored[`vol_${tab.id}`]);
        renderVolume(saved);
      } catch (_) {
        /* ignore */
      }
      return;
    }

    // Load stored volume (preserve mute 0)
    let savedVol = VU.NORMAL_PERCENT;
    try {
      const stored = await chrome.storage.local.get(`vol_${tab.id}`);
      savedVol = VU.resolveStoredPercent(stored[`vol_${tab.id}`]);
    } catch (_) {
      savedVol = VU.NORMAL_PERCENT;
    }

    renderVolume(savedVol);
    setControlsEnabled(true);
    // Do not claim saved volume is confirmed until reapply succeeds (or default skip).

    // Probe without forcing the audio graph. Re-apply only when needed:
    // non-default saved values after refresh, or controller already active at 100%.
    const status = await probeStatus(tab.id);
    if (!controlsEnabled) return;

    if (status) {
      const classified = VU.classifyStatus(status);
      // If only probing and never started, still allow controls; show media hint
      setOperationalState(classified.state, classified.label, classified.detail);
    }

    if (!VU.shouldReapplyOnOpen(savedVol, status)) {
      // Default 100% on a never-started controller: leave content fully lazy.
      confirmedVolume = VU.NORMAL_PERCENT;
      return;
    }

    // Re-apply saved / unity only when content may already be routing audio.
    // applyVolume sets confirmedVolume only on success; never badge/persist from init.
    await applyVolume(tab.id, savedVol, { persist: false, fromUser: false });
  }

  // Flush only last confirmed volume if popup closes mid-drag (never a failed request)
  window.addEventListener('pagehide', () => {
    if (currentTabId != null && controlsEnabled) {
      flushStorage(currentTabId, confirmedVolume);
    }
  });

  init();
})();
