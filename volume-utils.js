/**
 * Pure volume helpers shared by the popup (browser) and Node tests.
 * UMD-style: attaches to globalThis.VolumeUtils in browsers; CommonJS-friendly for Node.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.VolumeUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN_PERCENT = 0;
  const MAX_PERCENT = 600;
  const NORMAL_PERCENT = 100;
  const HIGH_BOOST_THRESHOLD = 300;
  const CLIP_RISK_THRESHOLD = 400;

  /**
   * Clamp a number into [min, max].
   * @param {number} n
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /**
   * Parse and normalize a volume percentage (0–600).
   * Invalid / non-finite values fall back to `fallback` (default 100).
   * @param {*} value
   * @param {number} [fallback=100]
   * @returns {number}
   */
  function normalizePercent(value, fallback = NORMAL_PERCENT) {
    if (value === null || value === undefined || value === '') {
      return clamp(fallback, MIN_PERCENT, MAX_PERCENT);
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
      return clamp(fallback, MIN_PERCENT, MAX_PERCENT);
    }
    return clamp(Math.round(n), MIN_PERCENT, MAX_PERCENT);
  }

  /**
   * Storage read that preserves mute (0). Avoids `|| 100` swallowing zero.
   * @param {*} storedValue
   * @param {number} [fallback=100]
   * @returns {number}
   */
  function resolveStoredPercent(storedValue, fallback = NORMAL_PERCENT) {
    if (storedValue === undefined || storedValue === null) {
      return normalizePercent(fallback);
    }
    return normalizePercent(storedValue, fallback);
  }

  /**
   * Convert percentage (0–600) to gain multiplier (0–6).
   * @param {number} percent
   * @returns {number}
   */
  function percentToGain(percent) {
    return normalizePercent(percent) / 100;
  }

  /**
   * Convert gain multiplier to percentage.
   * @param {number} gain
   * @returns {number}
   */
  function gainToPercent(gain) {
    const n = typeof gain === 'number' ? gain : Number(gain);
    if (!Number.isFinite(n)) return NORMAL_PERCENT;
    return normalizePercent(n * 100);
  }

  /**
   * Clamp untrusted incoming gain from messages to 0..6.
   * @param {*} value
   * @returns {number|null} null if malformed
   */
  function clampGain(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return clamp(n, 0, MAX_PERCENT / 100);
  }

  /**
   * Fraction of slider track filled (0–1) for a percentage.
   * @param {number} percent
   * @returns {number}
   */
  function percentToSliderFraction(percent) {
    return normalizePercent(percent) / MAX_PERCENT;
  }

  /**
   * Volume band for styling / badges.
   * @param {number} percent
   * @returns {'mute'|'normal'|'boost'|'high'|'max'}
   */
  function getVolumeBand(percent) {
    const v = normalizePercent(percent);
    if (v === 0) return 'mute';
    if (v <= NORMAL_PERCENT) return 'normal';
    if (v <= 200) return 'boost';
    if (v <= CLIP_RISK_THRESHOLD) return 'high';
    return 'max';
  }

  /**
   * Whether to show the high-boost clipping warning.
   * @param {number} percent
   * @returns {boolean}
   */
  function shouldShowHighBoostWarning(percent) {
    return normalizePercent(percent) > HIGH_BOOST_THRESHOLD;
  }

  /**
   * Human-readable value text for aria-valuetext.
   * @param {number} percent
   * @returns {string}
   */
  function formatValueText(percent) {
    return normalizePercent(percent) + ' percent';
  }

  /**
   * Whether a content-script apply/setVolume response is a confirmed success.
   * `null` / missing = transport failure or stale apply; `ok === false` = explicit reject.
   * @param {*} result
   * @returns {boolean}
   */
  function isApplySuccess(result) {
    return result != null && typeof result === 'object' && result.ok !== false;
  }

  /**
   * Whether the content controller has been started (AudioContext path may exist).
   * Prefers explicit `started` from the content script protocol.
   * @param {*} status
   * @returns {boolean}
   */
  function isControllerStarted(status) {
    if (!status || typeof status !== 'object') return false;
    if (typeof status.started === 'boolean') return status.started;
    if (status.code === 'NOT_STARTED') return false;
    if (status.contextState === 'none') return false;
    return status.contextState != null;
  }

  /**
   * On popup open: re-apply saved volume only when needed.
   * - Non-default saved values must reapply after refresh (lazy content restart).
   * - Default 100% must NOT start the audio graph unless the controller is already active.
   * @param {number} savedPercent
   * @param {*} status getStatus response (or null)
   * @returns {boolean}
   */
  function shouldReapplyOnOpen(savedPercent, status) {
    if (normalizePercent(savedPercent) !== NORMAL_PERCENT) return true;
    return isControllerStarted(status);
  }

  /**
   * Clamp a media element native volume snapshot to 0..1 (preserves legitimate 0).
   * @param {*} value
   * @param {number} [fallback=1]
   * @returns {number}
   */
  function normalizeNativeVolume(value, fallback = 1) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
      const f = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 1;
      return clamp(f, 0, 1);
    }
    return clamp(n, 0, 1);
  }

  /**
   * Volume to assign on unhooked (fallback) media elements.
   * Gain multiplies native output; native 0 must stay 0 (not coerced to 1).
   * Hooked elements should not rewrite `element.volume` at all.
   * @param {number} gain 0..6
   * @param {number} nativeSnap 0..1
   * @returns {number} 0..1
   */
  function computeFallbackElementVolume(gain, nativeSnap) {
    const g = typeof gain === 'number' && Number.isFinite(gain) ? Math.max(0, gain) : 1;
    const native = normalizeNativeVolume(nativeSnap, 1);
    if (g <= 0) return 0;
    if (g <= 1) return Math.min(1, g * native);
    return native;
  }

  /**
   * Classify popup / page operational status from content-script response shape.
   * @param {{ restricted?: boolean, ok?: boolean, started?: boolean, contextState?: string, mediaCount?: number, hookedCount?: number, code?: string, message?: string }} info
   * @returns {{ state: string, label: string, detail: string }}
   */
  function classifyStatus(info) {
    if (!info || info.restricted) {
      return {
        state: 'unavailable',
        label: 'Unavailable on this page',
        detail: (info && info.message) || 'This page cannot be controlled by the extension.'
      };
    }
    if (info.ok === false) {
      return {
        state: 'error',
        label: 'Error',
        detail: info.message || 'Could not apply volume on this page.'
      };
    }
    // Content script loaded but controller not started yet (no AudioContext).
    if (info.contextState === 'none' || info.code === 'NOT_STARTED') {
      const pendingMedia = Number(info.mediaCount) || 0;
      if (pendingMedia === 0) {
        return {
          state: 'no-media',
          label: 'No media yet',
          detail: 'Play media on this page to detect audio.'
        };
      }
      return {
        state: 'ready',
        label: 'Ready',
        detail: 'Media detected. Volume control will start when you change the level.'
      };
    }
    if (info.contextState === 'suspended') {
      return {
        state: 'waiting',
        label: 'Waiting for page interaction',
        detail: 'Click the page once to enable audio processing.'
      };
    }
    const mediaCount = Number(info.mediaCount) || 0;
    const hookedCount = Number(info.hookedCount) || 0;
    if (mediaCount === 0) {
      return {
        state: 'no-media',
        label: 'No media yet',
        detail: 'Play media on this page to detect audio.'
      };
    }
    if (hookedCount === 0 && mediaCount > 0) {
      return {
        state: 'error',
        label: 'Limited control',
        detail: info.message || 'Media found but could not be hooked (cross-origin or DRM).'
      };
    }
    return {
      state: 'ready',
      label: 'Ready',
      detail: hookedCount > 0
        ? 'Audio active on this tab.'
        : 'Volume control is ready.'
    };
  }

  /**
   * Restricted URL schemes / pages where content scripts cannot run.
   * @param {string|undefined|null} url
   * @returns {boolean}
   */
  function isRestrictedUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase();
    if (
      lower.startsWith('chrome://') ||
      lower.startsWith('chrome-extension://') ||
      lower.startsWith('edge://') ||
      lower.startsWith('about:') ||
      lower.startsWith('devtools://') ||
      lower.startsWith('view-source:') ||
      lower.startsWith('chrome-search://') ||
      lower.startsWith('chrome-error://')
    ) {
      return true;
    }
    // Chrome Web Store
    if (
      lower.includes('chrome.google.com/webstore') ||
      lower.includes('chromewebstore.google.com')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Short badge text for Chrome action badge (max ~4 chars practical).
   * @param {number} percent
   * @returns {string} empty string when normal (100)
   */
  function formatBadgeText(percent) {
    const v = normalizePercent(percent);
    if (v === NORMAL_PERCENT) return '';
    if (v === 0) return 'MUTE';
    return String(v);
  }

  /**
   * Badge background color by band.
   * @param {number} percent
   * @returns {string}
   */
  function badgeColorForPercent(percent) {
    const band = getVolumeBand(percent);
    if (band === 'max') return '#f87171';
    if (band === 'high') return '#a78bfa';
    if (band === 'mute') return '#64748b';
    return '#60a5fa';
  }

  return {
    MIN_PERCENT,
    MAX_PERCENT,
    NORMAL_PERCENT,
    HIGH_BOOST_THRESHOLD,
    CLIP_RISK_THRESHOLD,
    clamp,
    normalizePercent,
    resolveStoredPercent,
    percentToGain,
    gainToPercent,
    clampGain,
    percentToSliderFraction,
    getVolumeBand,
    shouldShowHighBoostWarning,
    formatValueText,
    isApplySuccess,
    isControllerStarted,
    shouldReapplyOnOpen,
    normalizeNativeVolume,
    computeFallbackElementVolume,
    classifyStatus,
    isRestrictedUrl,
    formatBadgeText,
    badgeColorForPercent
  };
});
