(() => {
  'use strict';

  /** @type {AudioContext|null} */
  let audioContext = null;
  /** @type {GainNode|null} */
  let gainNode = null;
  /** Module-owned set of hooked media elements */
  const hookedElements = new WeakSet();
  /** Live list of media we successfully routed (for gain + status) */
  const trackedMedia = new Set();
  /** Elements we failed to hook (cross-origin / already connected / DRM) */
  const failedElements = new WeakSet();
  /** Elements waiting for AudioContext to resume before hooking */
  const pendingHookElements = new Set();

  let currentGain = 1.0;
  let controllerReady = false;
  /** @type {MutationObserver|null} */
  let mediaObserver = null;
  let resumeListenersInstalled = false;
  let lastHookError = null;

  const RESUME_EVENTS = ['click', 'keydown', 'touchstart', 'pointerdown'];

  function clampGain(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(6, n));
  }

  function initAudioGraph() {
    if (audioContext && gainNode) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        lastHookError = 'AudioContext not available in this frame.';
        return false;
      }
      audioContext = new AC();
      gainNode = audioContext.createGain();
      gainNode.gain.value = currentGain;
      gainNode.connect(audioContext.destination);
      return true;
    } catch (_) {
      lastHookError = 'Failed to create AudioContext.';
      audioContext = null;
      gainNode = null;
      return false;
    }
  }

  function ensureNativeVolumeSnapshot(el) {
    if (el.dataset.vbpNativeVol === undefined) {
      const nv = typeof el.volume === 'number' && Number.isFinite(el.volume) ? el.volume : 1;
      // Preserve legitimate native 0 (site/user mute); do not coerce to 1.
      el.dataset.vbpNativeVol = String(Math.max(0, Math.min(1, nv)));
    }
  }

  function getNativeVolumeSnapshot(el) {
    const raw = el.dataset.vbpNativeVol;
    const n = raw !== undefined ? Number(raw) : 1;
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  }

  /**
   * Apply gain without destroying the site's native volume preference.
   * - Hooked: gain multiplies media-element output; do not rewrite el.volume/muted.
   * - Unhooked fallback: scale el.volume in 0..1, preserving native 0 and restoring
   *   the snapshot when gain returns to 1 (or >1 where only native can apply).
   */
  function applyElementVolume(el, gain, isHooked) {
    ensureNativeVolumeSnapshot(el);

    if (isHooked) {
      // Web Audio gain node alone controls boost/mute; leave native volume/mute alone.
      return;
    }

    const nativeSnap = getNativeVolumeSnapshot(el);
    try {
      if (gain <= 0) {
        el.volume = 0;
      } else if (gain <= 1) {
        el.volume = Math.min(1, gain * nativeSnap);
      } else {
        // Cannot boost past 1 without Web Audio; keep native (including 0).
        el.volume = nativeSnap;
      }
    } catch (_) {
      /* some elements throw on volume set */
    }
  }

  function hijackElement(el) {
    if (!(el instanceof HTMLMediaElement)) return false;
    if (hookedElements.has(el) || failedElements.has(el)) {
      return hookedElements.has(el);
    }
    if (!initAudioGraph() || !audioContext || !gainNode) return false;

    // If the AudioContext is suspended, defer hooking until a user gesture resumes it.
    if (audioContext.state === 'suspended') {
      if (!pendingHookElements.has(el)) {
        pendingHookElements.add(el);
        audioContext.resume().catch(() => {
          /* resume failed: element stays pending until a real user gesture */
        });
      }
      return false;
    }

    ensureNativeVolumeSnapshot(el);

    try {
      const src = audioContext.createMediaElementSource(el);
      src.connect(gainNode);
      hookedElements.add(el);
      trackedMedia.add(el);
      applyElementVolume(el, currentGain, true);
      return true;
    } catch (e) {
      // Fallback: try to capture the media element's own stream and route it.
      try {
        const capture =
          typeof el.captureStream === 'function'
            ? el.captureStream()
            : typeof el.mozCaptureStream === 'function'
              ? el.mozCaptureStream()
              : null;
        if (capture && audioContext) {
          const streamSrc = audioContext.createMediaStreamSource(capture);
          streamSrc.connect(gainNode);
          hookedElements.add(el);
          trackedMedia.add(el);
          applyElementVolume(el, currentGain, true);
          return true;
        }
      } catch (_) {
        /* captureStream fallback also failed */
      }

      failedElements.add(el);
      trackedMedia.add(el);
      lastHookError =
        (e && e.message) ||
        'Could not route media element (already connected, cross-origin, or DRM).';
      applyElementVolume(el, currentGain, false);
      // Ensure native volume is at maximum so the user at least gets full native loudness.
      try {
        el.volume = 1.0;
      } catch (_) {
        /* some elements throw on volume set */
      }
      return false;
    }
  }

  function scanAddedNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') {
      hijackElement(node);
    }
    if (typeof node.querySelectorAll === 'function') {
      node.querySelectorAll('audio, video').forEach((el) => hijackElement(el));
    }
  }

  function scanExistingMedia() {
    document.querySelectorAll('audio, video').forEach((el) => hijackElement(el));
  }

  function pruneTrackedMedia() {
    for (const el of trackedMedia) {
      if (!el.isConnected) {
        trackedMedia.delete(el);
      }
    }
  }

  function countMedia() {
    pruneTrackedMedia();
    // Prefer live DOM counts for status honesty
    const all = document.querySelectorAll('audio, video');
    let hooked = 0;
    let failed = 0;
    all.forEach((el) => {
      if (hookedElements.has(el)) hooked += 1;
      else if (failedElements.has(el)) failed += 1;
    });
    return {
      mediaCount: all.length,
      hookedCount: hooked,
      failedCount: failed
    };
  }

  function onMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        scanAddedNode(node);
      }
    }
  }

  function startObserver() {
    if (mediaObserver || !document.documentElement) return;
    mediaObserver = new MutationObserver(onMutations);
    mediaObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function stopObserver() {
    if (mediaObserver) {
      mediaObserver.disconnect();
      mediaObserver = null;
    }
  }

  function removeResumeListeners() {
    if (!resumeListenersInstalled) return;
    for (const type of RESUME_EVENTS) {
      document.removeEventListener(type, resumeFromGesture, true);
    }
    resumeListenersInstalled = false;
  }

  function resumeFromGesture() {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        if (audioContext && audioContext.state === 'running') {
          removeResumeListeners();
          // Process any elements that were waiting for the context to start.
          for (const el of pendingHookElements) {
            hijackElement(el);
          }
          pendingHookElements.clear();
        }
      }).catch(() => {
        /* keep listeners */
      });
    } else if (audioContext.state === 'running') {
      removeResumeListeners();
      for (const el of pendingHookElements) {
        hijackElement(el);
      }
      pendingHookElements.clear();
    }
  }

  function installResumeListenersIfNeeded() {
    if (!audioContext || audioContext.state !== 'suspended') {
      removeResumeListeners();
      return;
    }
    if (resumeListenersInstalled) return;
    for (const type of RESUME_EVENTS) {
      document.addEventListener(type, resumeFromGesture, { capture: true });
    }
    resumeListenersInstalled = true;
  }

  /**
   * Lazy controller init: only on first relevant command.
   */
  function ensureController() {
    if (controllerReady) {
      installResumeListenersIfNeeded();
      return initAudioGraph();
    }
    controllerReady = true;
    const ok = initAudioGraph();
    if (ok) {
      scanExistingMedia();
      startObserver();
      installResumeListenersIfNeeded();
    }
    return ok;
  }

  function setGainValue(gain) {
    currentGain = gain;
    if (gainNode && audioContext) {
      const now = audioContext.currentTime;
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setTargetAtTime(gain, now, 0.02);
      } catch (_) {
        gainNode.gain.value = gain;
      }
    }

    pruneTrackedMedia();
    const all = document.querySelectorAll('audio, video');
    all.forEach((el) => {
      if (!hookedElements.has(el) && !failedElements.has(el)) {
        hijackElement(el);
      }
      // If the element is pending (context suspended), ensure it will receive the
      // current gain once the context resumes and hijackElement succeeds.
      applyElementVolume(el, gain, hookedElements.has(el));
    });
  }

  function buildStatus(extra) {
    const counts = countMedia();
    const contextState = audioContext ? audioContext.state : 'none';
    const base = {
      ok: true,
      started: true,
      volume: currentGain,
      contextState,
      mediaCount: counts.mediaCount,
      hookedCount: counts.hookedCount,
      failedCount: counts.failedCount,
      code: null,
      message: null
    };
    if (lastHookError && counts.mediaCount > 0 && counts.hookedCount === 0) {
      base.code = 'HOOK_FAILED';
      base.message = lastHookError;
    }
    return Object.assign(base, extra || {});
  }

  /**
   * When reset to 100% (gain 1), stop discovery work if safe.
   * Keep the gain graph for already-hooked elements so playback stays correct.
   */
  function maybeIdleAtUnity() {
    if (currentGain !== 1) return;
    // Stop observing for new media; already-routed elements keep their graph.
    stopObserver();
    removeResumeListeners();
  }

  function handleSetVolume(rawVolume) {
    const gain = clampGain(rawVolume);
    if (gain === null) {
      return {
        ok: false,
        started: controllerReady,
        volume: currentGain,
        contextState: audioContext ? audioContext.state : 'none',
        mediaCount: 0,
        hookedCount: 0,
        code: 'INVALID_VOLUME',
        message: 'Volume must be a number between 0 and 6.'
      };
    }

    const graphOk = ensureController();
    if (!graphOk) {
      return {
        ok: false,
        started: controllerReady,
        volume: currentGain,
        contextState: 'none',
        mediaCount: 0,
        hookedCount: 0,
        code: 'NO_AUDIO_CONTEXT',
        message: lastHookError || 'AudioContext could not be created.'
      };
    }

    setGainValue(gain);

    if (gain === 1) {
      maybeIdleAtUnity();
    } else {
      // Boosting again: ensure we discover new media
      if (!mediaObserver) {
        scanExistingMedia();
        startObserver();
      }
      installResumeListenersIfNeeded();
    }

    return buildStatus({ ok: true, volume: gain });
  }

  function handleGetStatus() {
    // Status probe must not create AudioContext. Report whether the controller
    // already started so the popup can stay lazy at default 100%.
    if (!controllerReady) {
      const mediaCount = document.querySelectorAll('audio, video').length;
      return {
        ok: true,
        started: false,
        volume: currentGain,
        contextState: 'none',
        mediaCount,
        hookedCount: 0,
        failedCount: 0,
        code: 'NOT_STARTED',
        message: mediaCount === 0 ? null : 'Controller not started until volume is set.'
      };
    }
    installResumeListenersIfNeeded();
    return buildStatus({ started: true });
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (!request || typeof request !== 'object') {
      sendResponse({
        ok: false,
        code: 'INVALID_MESSAGE',
        message: 'Malformed message.'
      });
      return false;
    }

    if (request.action === 'setVolume') {
      sendResponse(handleSetVolume(request.volume));
      return false;
    }

    if (request.action === 'getStatus' || request.action === 'getVolume') {
      sendResponse(handleGetStatus());
      return false;
    }

    sendResponse({
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: 'Unknown action.'
    });
    return false;
  });

  // Boot: message listener only — no AudioContext, no scan, no observer, no timers.
})();
