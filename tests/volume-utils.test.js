'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const VU = require('../volume-utils.js');

describe('normalizePercent', () => {
  it('clamps negative to 0', () => {
    assert.equal(VU.normalizePercent(-10), 0);
  });

  it('preserves 0 (mute)', () => {
    assert.equal(VU.normalizePercent(0), 0);
  });

  it('preserves 100', () => {
    assert.equal(VU.normalizePercent(100), 100);
  });

  it('preserves mid values', () => {
    assert.equal(VU.normalizePercent(300), 300);
    assert.equal(VU.normalizePercent(400), 400);
  });

  it('preserves max 600', () => {
    assert.equal(VU.normalizePercent(600), 600);
  });

  it('clamps over-600', () => {
    assert.equal(VU.normalizePercent(999), 600);
  });

  it('parses numeric strings', () => {
    assert.equal(VU.normalizePercent('150'), 150);
    assert.equal(VU.normalizePercent('0'), 0);
  });

  it('falls back for invalid values', () => {
    assert.equal(VU.normalizePercent(NaN), 100);
    assert.equal(VU.normalizePercent(undefined), 100);
    assert.equal(VU.normalizePercent('nope'), 100);
    assert.equal(VU.normalizePercent(null), 100);
    assert.equal(VU.normalizePercent(Infinity), 100);
  });

  it('rounds fractional percentages', () => {
    assert.equal(VU.normalizePercent(99.6), 100);
    assert.equal(VU.normalizePercent(12.2), 12);
  });
});

describe('resolveStoredPercent', () => {
  it('preserves stored mute zero', () => {
    assert.equal(VU.resolveStoredPercent(0), 0);
  });

  it('returns fallback for missing', () => {
    assert.equal(VU.resolveStoredPercent(undefined), 100);
    assert.equal(VU.resolveStoredPercent(null), 100);
  });

  it('normalizes stored values', () => {
    assert.equal(VU.resolveStoredPercent(250), 250);
    assert.equal(VU.resolveStoredPercent('0'), 0);
  });
});

describe('percentToGain / gainToPercent / clampGain', () => {
  it('converts percent to gain', () => {
    assert.equal(VU.percentToGain(0), 0);
    assert.equal(VU.percentToGain(100), 1);
    assert.equal(VU.percentToGain(200), 2);
    assert.equal(VU.percentToGain(600), 6);
  });

  it('converts gain to percent', () => {
    assert.equal(VU.gainToPercent(0), 0);
    assert.equal(VU.gainToPercent(1), 100);
    assert.equal(VU.gainToPercent(4), 400);
  });

  it('clamps gain to 0..6 and rejects invalid', () => {
    assert.equal(VU.clampGain(-1), 0);
    assert.equal(VU.clampGain(0), 0);
    assert.equal(VU.clampGain(3.5), 3.5);
    assert.equal(VU.clampGain(10), 6);
    assert.equal(VU.clampGain('2'), 2);
    assert.equal(VU.clampGain('x'), null);
    assert.equal(VU.clampGain(undefined), null);
  });
});

describe('percentToSliderFraction', () => {
  it('maps range to 0–1', () => {
    assert.equal(VU.percentToSliderFraction(0), 0);
    assert.equal(VU.percentToSliderFraction(100), 100 / 600);
    assert.equal(VU.percentToSliderFraction(300), 0.5);
    assert.equal(VU.percentToSliderFraction(600), 1);
  });
});

describe('getVolumeBand', () => {
  it('classifies bands', () => {
    assert.equal(VU.getVolumeBand(0), 'mute');
    assert.equal(VU.getVolumeBand(50), 'normal');
    assert.equal(VU.getVolumeBand(100), 'normal');
    assert.equal(VU.getVolumeBand(150), 'boost');
    assert.equal(VU.getVolumeBand(200), 'boost');
    assert.equal(VU.getVolumeBand(250), 'high');
    assert.equal(VU.getVolumeBand(400), 'high');
    assert.equal(VU.getVolumeBand(401), 'max');
    assert.equal(VU.getVolumeBand(600), 'max');
  });
});

describe('shouldShowHighBoostWarning', () => {
  it('shows only above high-boost threshold', () => {
    assert.equal(VU.shouldShowHighBoostWarning(300), false);
    assert.equal(VU.shouldShowHighBoostWarning(301), true);
    assert.equal(VU.shouldShowHighBoostWarning(600), true);
    assert.equal(VU.shouldShowHighBoostWarning(100), false);
  });
});

describe('formatValueText', () => {
  it('returns accessible percent text', () => {
    assert.equal(VU.formatValueText(0), '0 percent');
    assert.equal(VU.formatValueText(200), '200 percent');
  });
});

describe('isApplySuccess', () => {
  it('rejects null, undefined, and transport failures', () => {
    assert.equal(VU.isApplySuccess(null), false);
    assert.equal(VU.isApplySuccess(undefined), false);
  });

  it('rejects explicit ok:false', () => {
    assert.equal(VU.isApplySuccess({ ok: false, code: 'NO_AUDIO_CONTEXT' }), false);
  });

  it('accepts ok:true and ok-omitted success-shaped objects', () => {
    assert.equal(VU.isApplySuccess({ ok: true, started: true, volume: 2 }), true);
    assert.equal(VU.isApplySuccess({ volume: 1, started: false }), true);
  });
});

describe('isControllerStarted / shouldReapplyOnOpen', () => {
  it('treats NOT_STARTED / started:false as inactive', () => {
    assert.equal(
      VU.isControllerStarted({ ok: true, started: false, code: 'NOT_STARTED', contextState: 'none' }),
      false
    );
    assert.equal(VU.isControllerStarted(null), false);
  });

  it('treats started:true as active', () => {
    assert.equal(
      VU.isControllerStarted({ ok: true, started: true, contextState: 'running' }),
      true
    );
  });

  it('does not reapply default 100% when controller never started', () => {
    assert.equal(
      VU.shouldReapplyOnOpen(100, {
        ok: true,
        started: false,
        code: 'NOT_STARTED',
        contextState: 'none',
        mediaCount: 1
      }),
      false
    );
  });

  it('reapplies non-default saved values even when not started (post-refresh)', () => {
    const idle = { ok: true, started: false, code: 'NOT_STARTED', contextState: 'none' };
    assert.equal(VU.shouldReapplyOnOpen(200, idle), true);
    assert.equal(VU.shouldReapplyOnOpen(0, idle), true);
    assert.equal(VU.shouldReapplyOnOpen(600, idle), true);
  });

  it('reapplies 100% only when controller is already active', () => {
    assert.equal(
      VU.shouldReapplyOnOpen(100, { ok: true, started: true, contextState: 'running', volume: 2 }),
      true
    );
  });
});

describe('normalizeNativeVolume / computeFallbackElementVolume', () => {
  it('preserves legitimate native zero', () => {
    assert.equal(VU.normalizeNativeVolume(0), 0);
    assert.equal(VU.normalizeNativeVolume('0'), 0);
  });

  it('does not coerce native 0 to 1 when applying gain', () => {
    assert.equal(VU.computeFallbackElementVolume(0, 0), 0);
    assert.equal(VU.computeFallbackElementVolume(0.5, 0), 0);
    assert.equal(VU.computeFallbackElementVolume(1, 0), 0);
    assert.equal(VU.computeFallbackElementVolume(2, 0), 0);
  });

  it('scales and restores non-zero native snapshots', () => {
    assert.equal(VU.computeFallbackElementVolume(0, 0.8), 0);
    assert.equal(VU.computeFallbackElementVolume(0.5, 0.8), 0.4);
    assert.equal(VU.computeFallbackElementVolume(1, 0.8), 0.8);
    assert.equal(VU.computeFallbackElementVolume(2, 0.8), 0.8);
  });
});

describe('classifyStatus', () => {
  it('marks restricted pages unavailable', () => {
    const r = VU.classifyStatus({ restricted: true });
    assert.equal(r.state, 'unavailable');
  });

  it('marks failed application as error', () => {
    const r = VU.classifyStatus({ ok: false, message: 'boom' });
    assert.equal(r.state, 'error');
    assert.match(r.detail, /boom/);
  });

  it('detects suspended context', () => {
    const r = VU.classifyStatus({ ok: true, contextState: 'suspended', mediaCount: 1, hookedCount: 1 });
    assert.equal(r.state, 'waiting');
  });

  it('detects no media', () => {
    const r = VU.classifyStatus({ ok: true, contextState: 'running', mediaCount: 0, hookedCount: 0 });
    assert.equal(r.state, 'no-media');
  });

  it('does not treat pre-init media as hook failure', () => {
    const r = VU.classifyStatus({
      ok: true,
      started: false,
      contextState: 'none',
      mediaCount: 2,
      hookedCount: 0,
      code: 'NOT_STARTED'
    });
    assert.equal(r.state, 'ready');
    assert.match(r.detail, /Media detected/i);
  });

  it('detects unhookable media', () => {
    const r = VU.classifyStatus({ ok: true, contextState: 'running', mediaCount: 2, hookedCount: 0 });
    assert.equal(r.state, 'error');
  });

  it('marks ready when hooked', () => {
    const r = VU.classifyStatus({ ok: true, contextState: 'running', mediaCount: 1, hookedCount: 1 });
    assert.equal(r.state, 'ready');
  });
});

describe('isRestrictedUrl', () => {
  it('flags missing and internal schemes', () => {
    assert.equal(VU.isRestrictedUrl(null), true);
    assert.equal(VU.isRestrictedUrl(''), true);
    assert.equal(VU.isRestrictedUrl('chrome://extensions'), true);
    assert.equal(VU.isRestrictedUrl('edge://settings'), true);
    assert.equal(VU.isRestrictedUrl('about:blank'), true);
    assert.equal(VU.isRestrictedUrl('chrome-extension://abc/popup.html'), true);
  });

  it('flags Chrome Web Store', () => {
    assert.equal(VU.isRestrictedUrl('https://chrome.google.com/webstore/detail/x'), true);
    assert.equal(VU.isRestrictedUrl('https://chromewebstore.google.com/detail/x'), true);
  });

  it('allows normal https pages', () => {
    assert.equal(VU.isRestrictedUrl('https://example.com/watch'), false);
    assert.equal(VU.isRestrictedUrl('http://localhost:3000/'), false);
  });
});

describe('formatBadgeText / badgeColorForPercent', () => {
  it('clears badge at 100%', () => {
    assert.equal(VU.formatBadgeText(100), '');
  });

  it('formats mute and boost', () => {
    assert.equal(VU.formatBadgeText(0), 'MUTE');
    assert.equal(VU.formatBadgeText(200), '200');
  });

  it('returns colors by band', () => {
    assert.equal(typeof VU.badgeColorForPercent(100), 'string');
    assert.equal(VU.badgeColorForPercent(500), '#f87171');
  });
});
