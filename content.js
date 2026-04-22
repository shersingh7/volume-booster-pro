(() => {
  'use strict';

  let gainNode = null;
  let audioContext = null;
  let sourceNodes = new WeakSet();
  let currentVolume = 1.0;

  // ── Initialize Audio Context & Gain ──
  const initAudio = () => {
    if (audioContext) return;

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = audioContext.createGain();
      gainNode.connect(audioContext.destination);
      gainNode.gain.value = currentVolume;
    } catch (e) {
      console.warn('[Volume Booster Pro] AudioContext not available:', e);
      return;
    }
  };

  // ── Hijack Audio Elements ──
  const hijackElement = (el) => {
    if (!audioContext || !gainNode) initAudio();
    if (!audioContext || !gainNode) return;

    // Already hooked
    if (el._vbpHooked) return;
    el._vbpHooked = true;

    try {
      const src = audioContext.createMediaElementSource(el);
      src.connect(gainNode);
      sourceNodes.add(src);
    } catch (e) {
      // May fail if element already connected
    }
  };

  // ── Hook existing elements ──
  const hookAllAudio = () => {
    document.querySelectorAll('audio, video').forEach(hijackElement);
  };

  // ── MutationObserver for dynamic content ──
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') {
            hijackElement(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('audio, video').forEach(hijackElement);
          }
        }
      }
    }
  });

  // ── Set Volume ──
  const setVolume = (vol) => {
    currentVolume = vol;

    if (!audioContext) initAudio();
    if (gainNode) {
      // Smooth ramp
      const now = audioContext.currentTime;
      gainNode.gain.setTargetAtTime(vol, now, 0.02);
    }

    // Fallback: also set native volume for elements we couldn't hook
    document.querySelectorAll('audio, video').forEach(el => {
      if (vol > 1) {
        // For boost, native volume stays at 1, we handle boost via gain
        if (!el._vbpHooked) el.volume = 1;
      } else {
        el.volume = vol;
      }
    });
  };

  // ── Message Listener ──
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'setVolume') {
      setVolume(request.volume);
      sendResponse({ success: true, volume: request.volume });
      return true;
    }
    if (request.action === 'getVolume') {
      sendResponse({ success: true, volume: currentVolume });
      return true;
    }
  });

  // ── Resume AudioContext on user interaction ──
  const resumeCtx = () => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  };
  document.addEventListener('click', resumeCtx, true);
  document.addEventListener('keydown', resumeCtx, true);
  document.addEventListener('touchstart', resumeCtx, true);

  // ── Boot ──
  hookAllAudio();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Re-hook periodically for SPA navigation
  setInterval(hookAllAudio, 2000);
})();
