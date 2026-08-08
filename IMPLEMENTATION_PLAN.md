# Implementation Plan: Fix Media Detection Across All Websites

## Problem

The extension only works on YouTube. On most other sites (Twitter/X, Twitch,
news sites, Spotify Web, TikTok, Instagram, any site with embedded video), the
extension reports "No media yet" or "Limited control" even when video is playing.

## Root Cause Analysis

### 1. `all_frames: false` in manifest.json — PRIMARY BUG

The content script only runs in the **top-level frame**. Many sites play media
inside **iframes** (embeds, ad frames, cross-origin video containers, HLS
players). Since the content script never runs in those frames, it can never
detect or hook the `<video>`/`<audio>` elements inside them.

YouTube works because its `<video>` element lives in the top-level document.

### 2. Popup only messages the top frame — SECONDARY BUG

`chrome.tabs.sendMessage(tabId, message)` without a `frameId` option only
delivers to the top-level frame. Even if content scripts were running in child
frames, the popup couldn't reach them.

### 3. Lazy MutationObserver — TERTIARY BUG

The MutationObserver only starts when `setVolume` is first called (lazy
controller init). Media added between `document_idle` and the first volume
change is missed. `getStatus` does a live `querySelectorAll` but that only
covers the top frame.

### 4. No frame enumeration

The popup has no mechanism to discover or communicate with child frames.

## Solution

### File-by-file changes

#### 1. `manifest.json`
- Set `"all_frames": true` in the content_scripts entry
- Add `"webNavigation"` to permissions (needed for `chrome.webNavigation.getAllFrames`)
- Bump version to `"1.3.0"`

#### 2. `content.js`
Key changes:
- **Start the MutationObserver at boot** (not lazily). Track media element
  existence in a `Set` even before the AudioContext is created. This makes
  `getStatus` accurate immediately — no more "No media yet" when media exists.
- **`handleGetStatus()` when `!controllerReady`**: report accurate `mediaCount`
  from the tracked set (which the always-on observer keeps updated), not just a
  one-shot `querySelectorAll`.
- **When `setVolume` arrives**: hook all tracked media elements (the observer
  has been finding them since boot).
- Each frame's content script is fully independent: own `AudioContext`, own
  `gainNode`, own `hookedElements`/`failedElements` sets. No cross-frame
  coordination needed in the content script.
- The content script does NOT need to know its own `frameId` — the popup
  handles frame targeting.

Detailed changes:
- Move `startObserver()` call from `ensureController()` to the boot section
  (bottom of the IIFE). The observer runs from page load, tracking media
  elements in `trackedMedia` as they appear.
- Add a `discoveredMedia` WeakSet (or reuse `trackedMedia`) to track all media
  elements the observer has seen, even before controller init.
- In `handleGetStatus()` when `!controllerReady`: use `trackedMedia.size` (or
  live query) for `mediaCount`.
- In `ensureController()`: don't call `startObserver()` again if already
  running; just call `scanExistingMedia()` to hook already-tracked elements.
- Keep the lazy AudioContext creation — only create it on first `setVolume`.
  The observer just tracks element existence, not hooking.

#### 3. `popup.js`
Key changes:
- **Enumerate all frames** on popup open using `chrome.webNavigation.getAllFrames({tabId})`.
- **Broadcast `getStatus`** to every frame via `chrome.tabs.sendMessage(tabId, msg, {frameId})`.
- **Aggregate status** across all frames: sum `mediaCount`, `hookedCount`,
  `failedCount`. Use the best state across frames (if any frame is "ready",
  show "ready"; if all are "no-media", show "no-media").
- **Broadcast `setVolume`** to every frame on slider/preset change.
- **Cache frame IDs** when popup opens. On `setVolume`, send to all cached
  frames. If any frame returns a "no receiver" error, silently skip it (frame
  may have navigated away).
- **Refresh frame list** if a `setVolume` broadcast has errors on any frame.

Detailed changes:
- Add `async function getAllFrameIds(tabId)` that calls
  `chrome.webNavigation.getAllFrames({tabId})` and returns array of frame IDs.
- Add `async function broadcastToFrames(tabId, message)` that sends to all
  known frames and returns array of `{frameId, result}`.
- Add `async function probeStatusAllFrames(tabId)` that broadcasts `getStatus`
  to all frames and returns aggregated status.
- Modify `applyVolume()` to broadcast `setVolume` to all frames instead of
  just the top frame.
- Modify `probeStatus()` to use the multi-frame version.
- Add frame count to the status display (e.g., "Audio active on this tab" →
  "Audio active in 3 frames on this tab").
- Store volume per-tab (not per-frame) — all frames share the same gain.

#### 4. `volume-utils.js`
- Add `aggregateFrameStatus(statuses)` function:
  - Input: array of per-frame status objects (from `getStatus` responses)
  - Output: single aggregated status object with summed counts and best state
  - Logic: `mediaCount` = sum across frames, `hookedCount` = sum,
    `failedCount` = sum, `contextState` = best state (running > suspended >
    none), `started` = true if any frame is started, `code`/`message` = from
    the worst frame if all failed
- Export `aggregateFrameStatus` in the return object.

#### 5. `background.js`
- No changes needed. Badge updates remain per-tab. The popup sends the
  aggregated volume to the background for badge display.

#### 6. `scripts/check.js`
- Change the `all_frames` check from "must be false/omitted" to "must be true".
- Add a check that `"webNavigation"` is in the permissions array.
- Add a check that `popup.js` uses `chrome.webNavigation.getAllFrames`.
- Add a check that `volume-utils.js` exports `aggregateFrameStatus`.

#### 7. `tests/volume-utils.test.js`
- Add test suite for `aggregateFrameStatus`:
  - Empty array → no-media state
  - Single frame with media → that frame's status
  - Multiple frames, some with media, some without → summed counts
  - Multiple frames, all failed → error state
  - Mixed: one ready, one no-media → ready state
  - `contextState` aggregation: running + suspended → running

#### 8. `README.md`
- Update the "How it works" section to mention multi-frame support.
- Update the architecture diagram to show frame broadcasting.
- Update the "Architecture limits" table.

## Implementation Order

1. `manifest.json` — add `all_frames: true`, `webNavigation` permission, bump version
2. `volume-utils.js` — add `aggregateFrameStatus` (pure function, testable)
3. `tests/volume-utils.test.js` — add tests for `aggregateFrameStatus`
4. `content.js` — start observer at boot, track media before controller init
5. `popup.js` — frame enumeration, broadcast setVolume/getStatus, aggregate
6. `scripts/check.js` — update guards for `all_frames: true` and `webNavigation`
7. `README.md` — update docs

## Verification

```bash
npm test          # all tests pass including new aggregateFrameStatus tests
npm run check     # all checks pass with updated guards
```

Manual verification:
- Load the extension in Chrome
- Open a site with iframe-embedded video (e.g., a news article with an embedded
  Twitter/X video, or a Twitch clip embed)
- Open the popup → should show "Ready" or "Media detected" (not "No media yet")
- Set volume to 200% → audio should boost in the iframe media
- Open a regular YouTube video → should still work as before
- Open a page with no media → should show "No media yet"

## Constraints

- Keep the lazy AudioContext pattern (only create on first setVolume)
- Keep per-tab storage (not per-frame)
- No polling, no setInterval
- No remote fonts or external resources
- Manifest V3 compatible
- Node 18+ for tests