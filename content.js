(() => {
  'use strict';

  let gainNode = null;
  let audioContext = null;
  let currentVolume = 1.0;

  // Track elements that need native-volume fallback (couldn't hook via Web Audio)
  const fallbackElements = new Set();

  const initAudio = () => {
    if (audioContext) return true;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = audioContext.createGain();
      gainNode.connect(audioContext.destination);
      gainNode.gain.value = currentVolume;
    } catch (e) {
      return false;
    }
    return true;
  };

  const resumeCtx = () => {
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
  };

  // Self-removing resume listener
  {
    const events = ['click', 'keydown', 'touchstart'];
    const resumeOnce = () => {
      resumeCtx();
      if (audioContext && audioContext.state === 'running') {
        events.forEach(e => document.removeEventListener(e, resumeOnce, true));
      }
    };
    events.forEach(e => document.addEventListener(e, resumeOnce, true));
  }

  // ── Hijack: Web Audio gain routing ──
  const hijackElement = (el) => {
    if (el._vbpHooked) return;
    if (!audioContext && !initAudio()) return;

    el._vbpHooked = true;
    try {
      audioContext.createMediaElementSource(el).connect(gainNode);
    } catch (_) {
      // Already bound to another AudioContext — use native volume fallback
      el._vbpHooked = 'fallback';
      fallbackElements.add(el);
    }
  };

  // ── Set Volume: zero DOM queries ──
  const setVolume = (vol) => {
    currentVolume = vol;
    if (!audioContext && !initAudio()) return;

    if (gainNode) {
      gainNode.gain.setTargetAtTime(vol, audioContext.currentTime, 0.02);
    }

    // Only touch elements we couldn't hook via Web Audio
    for (const el of fallbackElements) {
      el.volume = vol > 1 ? 1 : vol;
    }
  };

  const hookAllAudio = () => {
    document.querySelectorAll('audio, video').forEach(hijackElement);
  };

  // ── MutationObserver: fast-path early exits ──
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const nodes = m.addedNodes;
      if (!nodes.length) continue;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.nodeType !== 1) continue; // only ELEMENT_NODE

        const tag = node.tagName;
        if (tag === 'AUDIO' || tag === 'VIDEO') {
          hijackElement(node);
        }
        // Check for nested audio/video — skip text-only containers
        if (node.querySelectorAll) {
          node.querySelectorAll('audio, video').forEach(hijackElement);
        }
      }
    }
  });

  // ── SPA navigation detection ──
  let lastUrl = location.href;
  const onNavigation = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    requestAnimationFrame(() => {
      setTimeout(hookAllAudio, 100);
    });
  };

  const _push = history.pushState;
  const _replace = history.replaceState;
  history.pushState = function(...a) { _push.apply(this, a); onNavigation(); };
  history.replaceState = function(...a) { _replace.apply(this, a); onNavigation(); };
  window.addEventListener('popstate', onNavigation);

  // ── Message handler ──
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'setVolume':
        setVolume(request.volume);
        sendResponse({ success: true, volume: request.volume });
        return true;
      case 'getVolume':
        sendResponse({ success: true, volume: currentVolume });
        return true;
    }
  });

  // ── Boot ──
  hookAllAudio();
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
