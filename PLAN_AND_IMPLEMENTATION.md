# Volume Booster Pro — Efficiency and UI Redesign Plan

> **Implementation owner:** Grok Build. Implement this plan fully in the repository, update the implementation record at the bottom, and verify the finished extension. Do not stop after planning.

**Goal:** Make the Manifest V3 Chrome extension materially cheaper on every page, more reliable under real browser constraints, clearer when a page cannot be controlled, and substantially more polished and accessible without adding a framework or build step.

**Architecture:** Keep the extension dependency-free and use the existing popup → content script → Web Audio API architecture. Convert the content script from permanent polling/global work into a lazy, event-driven controller; coalesce high-frequency popup work; use the service worker only for badge/storage cleanup. Redesign the popup as a compact, high-contrast control surface with explicit state and error feedback.

**Tech stack:** Manifest V3, vanilla HTML/CSS/JavaScript, Chrome Extensions APIs, Web Audio API, Node syntax/test scripts where useful.

---

## 1. Code Review Findings

### Critical efficiency problems

1. `content.js` runs in **every frame on every URL at `document_start`**, starts a subtree `MutationObserver`, installs three permanent capture listeners, and scans the whole document every two seconds. That is a ridiculous cost for an extension that is idle almost all the time.
2. `hookAllAudio()` repeatedly calls `querySelectorAll('audio, video')`; `setVolume()` scans all media again; and the periodic scan never stops.
3. `sourceNodes` is a `WeakSet` that is written to but never read. DOM nodes are marked with a private `_vbpHooked` expando instead of a module-owned `WeakSet`.
4. Popup slider `input` events can flood tab messaging and `chrome.storage.local.set()` writes. The duplicate `change` handler repeats the final work.
5. “Reset All” queries and messages every open tab serially from a tiny popup. It is surprising, slow, and semantically mismatched with the extension’s advertised per-tab control.
6. Hot-path UI updates mutate inline `filter`, `color`, and element widths. Width animation causes layout/paint; class changes and `transform: scaleX()` are cheaper.

### Correctness and resilience problems

1. The popup silently swallows failures on restricted pages (`chrome://`, Chrome Web Store, PDF/internal pages, discarded tabs, or pages where no content script exists). The UI still pretends the boost is active.
2. Audio context state is not surfaced. A suspended context can make the user think the extension is broken, and connecting a media element to a suspended context can interrupt playback until the page receives a user gesture.
3. `createMediaElementSource()` errors are swallowed. The caller gets `{ success: true }` even if nothing was hooked.
4. Stored volume uses `stored[key] || 100`, which turns a valid stored mute value (`0`) into `100`.
5. `getColorForVolume()` is dead code. `tabIndicator`, `tabLabel`, and some CSS variables are unused or misleading.
6. The README’s “distortion-free amplification” claim is false. Gain above 1.0 can clip; DRM and cross-origin media also have real limitations.
7. The popup imports Google Fonts remotely. That is unnecessary startup/network work, a privacy blemish, and unreliable under extension CSP/offline use.
8. There are no automated tests for pure state/math logic and no repeatable package validation script.

### UI and accessibility problems

1. The current popup spends most of its space on a decorative ring while the actual control and status are secondary.
2. State is ambiguous: “This Tab” always looks green even when the page is unsupported or audio is suspended.
3. The 0–600 range compresses the useful 0–200 region; 100% is only one-sixth of the track. Add a clearly visible normal marker and make presets carry numeric values.
4. Preset labels (“Boost”, “Max”) omit the percentages, and “Max” maps to 400% even though the slider reaches 600%.
5. Focus styles, ARIA value text, status announcements, reduced-motion behavior, and sufficiently large targets are missing.
6. The screenshot/store presentation has extremely poor contrast and does not communicate a premium usable product. The actual popup must use deliberate contrast, restrained effects, and crisp hierarchy rather than glow soup.

---

## 2. Product and Design Direction

Build a **compact dark audio console**, not a decorative dashboard:

- Popup target: approximately 380 px wide and 500–560 px tall, no scrolling at normal Chrome popup dimensions.
- Use local system fonts only: `Inter` may remain only as a fallback name; do not load remote assets.
- Palette: near-black/navy surface, cool blue primary accent, violet for strong boost, amber/red only for clipping-risk warnings and destructive/reset affordances.
- Top row: product identity plus a real status pill (`Ready`, `Waiting for page interaction`, `No media yet`, `Unavailable on this page`, `Error`).
- Main control: large numeric percentage and a compact meter/ring that supports the number rather than dominating it.
- Slider: thick enough to target, 100% reference marker, endpoints, useful accessible label, and `aria-valuetext`.
- Presets: `Mute 0%`, `Normal 100%`, `Boost 200%`, `Loud 400%`, optionally `Max 600%` only if layout remains clear. The active preset must be obvious without relying on color alone.
- Active tab card: favicon, one-line title/domain, and concise operational status. Do not duplicate the same percentage in three places.
- Footer: `Reset this tab` as a secondary action; no global reset unless placed behind an explicit confirmation/menu (YAGNI: remove global reset now).
- Warning copy appears only above a high-gain threshold (for example >300%): “High boost may distort audio. Lower the level if you hear clipping.”
- All controls must have visible keyboard focus; honor `prefers-reduced-motion`; avoid continuous pulsing.

---

## 3. Implementation Tasks

### Task 1 — Establish testable shared volume utilities

**Objective:** Move deterministic calculations/state classification out of DOM-heavy popup code so they can be tested directly.

**Files:**
- Create: `volume-utils.js`
- Create: `tests/volume-utils.test.js`
- Create or modify: `package.json` (scripts only; no runtime dependencies)
- Modify: `popup.html`
- Modify: `popup.js`

**Steps:**
1. Create pure helpers for clamping/normalizing volume, percentage-to-slider scale, volume band/status classification, and storage fallback that preserves `0`.
2. Export helpers in a way that works in Node tests while exposing them to the popup without remote code or bundling (for example a small UMD/global module).
3. Load `volume-utils.js` before `popup.js`.
4. Add Node built-in test-runner coverage for boundaries: negative, 0, 100, 300/400 thresholds, 600, over-600, numeric strings/invalid values, and stored zero.
5. Add scripts such as `test`, `check`, and `package` only where they are genuinely useful. `check` must parse the manifest and run `node --check` over extension JavaScript plus tests.

**Verification:**
```bash
npm test
npm run check
```
Expected: all tests pass and all JavaScript/JSON syntax checks succeed.

### Task 2 — Make the content script lazy and event-driven

**Objective:** Eliminate permanent polling and minimize idle work on every page/frame.

**Files:**
- Modify: `manifest.json`
- Modify: `content.js`

**Steps:**
1. Remove `all_frames: true` unless a demonstrated requirement justifies it. Default to the top frame to avoid multiple audio graphs and multiplied observers.
2. Remove the two-second `setInterval` entirely.
3. Do not initialize `AudioContext`, scan media, observe the DOM, or install resume listeners at boot. At boot, only register the runtime message listener.
4. On the first relevant command, initialize the audio controller, scan existing media once, and start a `MutationObserver` only when needed.
5. In mutation processing, inspect only added elements/subtrees; never rescan the whole document. Use a module-owned `WeakSet` (or a stable data marker) to track hooked elements.
6. Maintain a tracked media collection only as needed for fallback updates. Clean up disconnected entries or use weak references/DOM query strategy that does not leak.
7. Install resume listeners only while the `AudioContext` is suspended; use `{ capture: true, once: true }` where practical, and remove all of them after a successful resume.
8. Return structured responses from `setVolume`/`getStatus`, e.g. `{ ok, volume, contextState, mediaCount, hookedCount, code, message }`. Do not claim success when initialization failed.
9. Clamp untrusted incoming volume to `0..6` and reject malformed messages.
10. Keep native media volume semantics sane: at `0`, mute effectively; from `0..1`, avoid double attenuation between native volume and gain; above `1`, use gain while preserving the user/site’s own native volume where possible. Do not permanently overwrite a site’s chosen native volume without restoring it.
11. Treat `createMediaElementSource` failures and cross-origin/DRM limitations as visible status, not swallowed exceptions. Do not spam the page console.
12. Disconnect the observer and avoid further media work when the tab is reset to 100% if the graph can remain correct without observation. If already-routed elements require the gain node to preserve playback, leave the graph intact but stop unnecessary discovery work only when safe.

**Verification:**
- Static search confirms no `setInterval` and no unconditional boot-time `querySelectorAll`/observer.
- On an ordinary non-media page, loading the extension performs no audio initialization or recurring work.
- On a page with existing and dynamically inserted `<audio>`/`<video>`, setting boost hooks each element at most once.

### Task 3 — Coalesce popup writes and messages

**Objective:** Keep dragging and keyboard input smooth without flooding Chrome APIs.

**Files:**
- Modify: `popup.js`
- Modify: `background.js` if badge routing is simplified

**Steps:**
1. Separate immediate visual rendering from side effects.
2. During slider drag, render every input locally but coalesce `chrome.tabs.sendMessage` to at most once per animation frame.
3. Debounce storage persistence on the trailing edge (roughly 120–200 ms) and flush the final value on `change`/popup lifecycle where reliable.
4. Remove duplicate application work between `input` and `change`.
5. Coalesce keyboard repeat in the same path rather than creating a second message strategy.
6. Use `Promise.allSettled` only where parallel work remains necessary. Replace “Reset All” with a single current-tab reset.
7. Update the badge from a trusted successful application path. Clear it at exactly 100%; keep text short enough for Chrome’s badge.
8. Ensure opening the popup does not blindly rewrite storage or claim success before the content script responds.
9. Use nullish fallback (`??`) so stored `0` remains mute.

**Verification:**
- A long slider drag produces many visual frames but substantially fewer storage writes/messages.
- Mute survives closing/reopening the popup.
- Reset affects only the active tab.

### Task 4 — Redesign semantic popup markup

**Objective:** Build a concise, accessible hierarchy and explicit operating states.

**Files:**
- Modify: `popup.html`

**Steps:**
1. Use semantic `header`, `main`, named `section`s, and footer/action markup.
2. Add a visible status pill and an `aria-live="polite"` status region.
3. Give the range input a real `<label>`, descriptive text, `aria-valuemin/max/now/valuetext`, and a visible 100% reference marker.
4. Change presets to include numeric values and `aria-pressed`; make active state understandable without color alone.
5. Add an inline high-boost warning region that is hidden below the threshold.
6. Give icon-only SVGs `aria-hidden="true"`; ensure actionable elements have accessible names.
7. Provide a disabled/unavailable state for restricted pages rather than leaving controls apparently functional.
8. Rename reset to `Reset this tab`.
9. Keep all code local and MV3-CSP compliant.

**Verification:**
- Keyboard tab order is logical.
- Screen-reader names expose slider purpose, exact percentage, preset selection, and status.
- Restricted pages visibly disable unsupported controls.

### Task 5 — Replace the visual system and remove expensive styling

**Objective:** Deliver a premium UI with better contrast and cheaper rendering.

**Files:**
- Rewrite: `popup.css`

**Steps:**
1. Remove Google Fonts `@import`; use a system font stack.
2. Define a restrained token system for surfaces, borders, text, accents, focus ring, warning, radii, and spacing.
3. Reduce blur/filter layers and ambient fixed glows. One subtle background treatment is enough.
4. Replace slider fill `width` animation with a full-width bar using `transform: scaleX()` and `transform-origin: left`.
5. Replace inline color/filter mutations with volume-band/status classes on a root element.
6. Replace `transition: all` with explicit properties.
7. Ensure body dimensions fit without clipping or unnecessary scrolling.
8. Use minimum ~40 px targets for presets/buttons and strong `:focus-visible` outlines.
9. Add styles for loading, ready, suspended/waiting, no-media, unavailable, and error states.
10. Add `@media (prefers-reduced-motion: reduce)` to disable nonessential transitions/animations. Remove the permanent pulsing dot.
11. Verify WCAG-level readable contrast for primary/secondary text on actual surfaces.

**Verification:**
- UI remains legible at 100% Chrome zoom and high-DPI scaling.
- No remote font/network request.
- No continuous animation at idle.
- Focus is always visible.

### Task 6 — Make popup state and error handling honest

**Objective:** Users must know whether the requested boost is actually active.

**Files:**
- Modify: `popup.js`
- Modify: `content.js`

**Steps:**
1. Model explicit popup states: `loading`, `ready`, `waiting`, `no-media`, `unavailable`, `error`.
2. Detect restricted URL schemes before messaging (`chrome:`, `chrome-extension:`, `edge:`, `about:`, Web Store pages, missing tab ID/URL) and disable controls with useful copy.
3. Wrap Chrome API calls and classify expected “receiving end does not exist” errors without noisy logging.
4. Use structured content-script responses to render `Audio active`, `Play media to detect audio`, or `Click the page once to enable audio` accurately.
5. Do not persist or badge a value if application failed. Preserve the previous confirmed state or explain that the chosen level is pending.
6. Guard async races: if rapid changes resolve out of order, only the latest request may update confirmed status.
7. Handle favicon failure without layout shift and provide sensible alt/decorative behavior.

**Verification:**
- Test on a normal HTML media page, a page with no media, and `chrome://extensions`.
- No uncaught popup or content-script console errors.
- UI never shows `Ready` after a failed send.

### Task 7 — Update metadata, docs, and package hygiene

**Objective:** Keep claims honest and produce a clean loadable artifact.

**Files:**
- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `PRIVACY.md` only if behavior/data handling changes
- Create/modify: `.gitignore`
- Create: package/archive through script; do not commit generated archive unless repository convention explicitly requires it

**Steps:**
1. Bump the manifest version for this material release (use `1.1.0` unless implementation warrants another semantic version).
2. Remove unused permissions/fields only after verifying API usage. Keep `<all_urls>` only because arbitrary-site content-script injection is core functionality and document why.
3. Correct “distortion-free” and explain clipping, suspended context, cross-origin media, DRM, restricted pages, and per-tab lifecycle honestly.
4. Document the redesigned controls, status states, keyboard behavior, development checks, and packaging command.
5. Add `.DS_Store`, generated zip files, and other local artifacts to `.gitignore`. Do not delete the user’s existing untracked archive or `.DS_Store` unless explicitly necessary; simply exclude them from new packaging and leave them unmodified.
6. Package only required extension runtime files and assets. Exclude `.git`, tests, local artifacts, and previous archives.
7. Validate the produced zip contains no nested duplicate project folder unless intentionally required by the chosen install flow.

**Verification:**
```bash
npm test
npm run check
npm run package
unzip -l <generated-archive>
git diff --check
git status --short
```
Expected: tests/checks pass; package contains the correct runtime files; no whitespace errors; pre-existing untracked user files remain untouched.

### Task 8 — Browser acceptance and visual verification

**Objective:** Prove the extension works in Chrome, not just under syntax checks.

**Files:**
- Modify any implementation file only if acceptance finds a real defect.
- Optionally create a deterministic local test fixture under `tests/fixtures/media.html`.

**Steps:**
1. Load the unpacked repository in a Chrome test profile if tooling permits.
2. Open a deterministic page containing audio/video plus a button that dynamically inserts another media element.
3. Open the popup and inspect initial state, visual layout, focus styles, and console errors.
4. Exercise slider, presets, keyboard arrows, mute persistence, normal reset, dynamic media detection, and high-boost warning.
5. Inspect extension/page console logs and confirm no recurring timer/scanning behavior.
6. Open the popup on `chrome://extensions` and verify unavailable state.
7. Test reduced-motion emulation if browser tooling supports it.
8. Capture a screenshot of the final popup for review if possible. Do not overwrite store assets with a fake mockup; only update them from a real final UI capture/composition.

**Verification gate:**
- Primary workflow works in the actual browser.
- No visual clipping at the target popup size.
- No uncaught console errors.
- Status accurately reflects ready/waiting/no-media/unavailable states.
- `git diff --check`, `npm test`, and `npm run check` remain green after acceptance fixes.

---

## 4. Acceptance Criteria

- [x] No polling interval remains in the content script.
- [x] Idle pages do not create an `AudioContext`, scan media repeatedly, or run a permanent observer.
- [x] Slider activity is visually immediate but Chrome API/storage side effects are coalesced.
- [x] Stored mute (`0`) restores correctly.
- [x] Reset affects only the active tab.
- [x] Popup has explicit, honest operational states and disables unsupported pages.
- [x] No external font or runtime asset request is used.
- [x] UI has visible focus, ARIA state/value updates, reduced-motion support, readable contrast, and no idle pulsing.
- [x] High gain includes a clipping/distortion warning.
- [x] Documentation no longer promises distortion-free or universal support.
- [x] Automated tests, syntax/manifest checks, packaging inspection, and `git diff --check` pass.
- [x] Existing untracked `.DS_Store` and `volume-booster-pro.zip` are not overwritten or deleted.
- [x] Actual browser verification is attempted and its result is recorded honestly.

---

## 5. Constraints and Non-Goals

- No React/Vue/Svelte, bundler, CSS framework, analytics, telemetry, remote code, or runtime CDN.
- No broadening permissions to paper over design problems.
- No offscreen document/tab-capture rewrite unless testing proves the current element-based Web Audio architecture cannot satisfy the scoped behavior; document such a blocker rather than silently expanding scope.
- Do not claim DRM/cross-origin compatibility that was not demonstrated.
- Do not commit or push unless explicitly asked.
- Preserve user-created/untracked files.

---

## 6. Implementation Record (Grok Build must update)

### Files changed

**Modified**
- `manifest.json` — v1.1.0; top-frame only (`all_frames: false`); `document_idle`; description updated
- `content.js` — full rewrite: message-only boot; lazy AudioContext/observer; structured responses; native volume snapshots; no `setInterval`
- `popup.html` — semantic console layout; status pill; labeled slider; numeric presets; high-boost warning; `volume-utils.js` load order
- `popup.css` — rewrite: system fonts; tokens; `scaleX` fill; band/state classes; focus-visible; reduced-motion; no remote assets
- `popup.js` — honest states; rAF-coalesced messages; debounced storage; mute-safe `??`/resolveStored; single-tab reset; race guards
- `background.js` — badge via trusted percent; storage cleanup on tab remove
- `README.md` — honest limits, architecture, npm scripts
- `PRIVACY.md` — no remote fonts/CDN; last-updated note

**Created**
- `volume-utils.js` — pure shared helpers (UMD/global + CommonJS)
- `package.json` — `test` / `check` / `package` scripts only (no runtime deps)
- `scripts/check.js` — manifest + `node --check` + efficiency guards
- `scripts/package.js` — runtime-only `dist-volume-booster-pro.zip` (does not touch `volume-booster-pro.zip`)
- `tests/volume-utils.test.js` — Node test runner coverage
- `tests/fixtures/media.html` — local media + dynamic insert fixture
- `.gitignore` — `.DS_Store`, zips, logs, review PNG, etc.

**Preserved (unmodified)**
- `.DS_Store` (Jun 6 2026 timestamp unchanged)
- `volume-booster-pro.zip` (Apr 22 2026 timestamp unchanged)
- Store promo/screenshot PNGs and icons (unchanged)

### Key decisions and deviations

1. **Top frame only** — Removed `all_frames: true` as specified. Nested iframe media is out of scope unless a future need is proven.
2. **`document_idle` vs `document_start`** — Idle is enough because the controller is message-driven and does not boot-scan.
3. **Unity gain idling** — At 100% gain the MutationObserver and resume listeners are stopped; already-hooked graphs stay connected so playback is not broken.
4. **Max preset 600%** — Included fifth preset; layout remains five equal columns without scroll at ~380×560.
5. **Package name** — Emit `dist-volume-booster-pro.zip` so the user’s existing `volume-booster-pro.zip` is never overwritten.
6. **No store asset replacement** — Real popup screenshot captured under `/tmp` and optionally `tests/fixtures/popup-review.png` (gitignored); did not overwrite CWS promo images.
7. **Branded Chrome 150 cannot `--load-extension`** — Automated browser acceptance used **Chrome for Testing 151** where CLI extension load still works. Stock Google Chrome 150 ignored `--load-extension` (known removal).

### Commands run and results

```text
npm test
# 31 tests, 10 suites, pass 31, fail 0

npm run check
# manifest OK, all JS syntax OK, no setInterval, no remote fonts, script order OK
# check passed

npm run package
# dist-volume-booster-pro.zip with 11 runtime files at archive root
# (volume-booster-pro.zip left untouched)

git diff --check
# exit 0 (no whitespace errors)

git status --short
# modified: PRIVACY.md README.md background.js content.js manifest.json
#           popup.css popup.html popup.js
# untracked: .gitignore PLAN_AND_IMPLEMENTATION.md package.json scripts/
#            tests/ volume-utils.js
# (.DS_Store and zips gitignored; still present on disk)
```

### Browser acceptance result

**Environment**
- Google Chrome 150.0.7871.115 (branded): `--load-extension` does **not** load unpacked extensions; false-positive component SW IDs observed. Not usable for automated extension load.
- Chrome for Testing 151.0.7922.34: extension loaded as `fjidplogilgamgiiihdaccillkmjdhee`.
- Local HTTP fixture: `http://127.0.0.1:8765/tests/fixtures/media.html` (static Node server).

**Verified via CDP (Chrome for Testing)**
- Content script boot: `getStatus` before any set → `contextState: "none"`, media counted, controller not started.
- `setVolume` 2.0 / 3.5 / 6.0 / 0 / 1.0 → `ok: true`, `hookedCount: 2` on fixture audio+video; context often `suspended` until user gesture (expected).
- Invalid volume string → `ok: false`, `INVALID_VOLUME`.
- Mute storage: `chrome.storage.local` value `0` resolves to mute via `resolveStoredPercent` (not coerced to 100).
- Badge update from popup path → `{ ok: true }`.
- Restricted page (`chrome://version`) → message channel error (no content script); popup classifies `chrome-extension:` / internal URLs as unavailable and disables controls.
- Popup UI: title “Volume Booster Pro”, body ~380×558, presets include Mute 0% … Max 600%, “Reset this tab”, no Google Fonts, `VolumeUtils` present, `:focus-visible` rules present, high-boost warning shows above 300%.
- Screenshot written to `/tmp/vbp-popup.png` (review only).

**Not fully verified in an interactive human session**
- True toolbar action popup on a focused media tab (automation used extension page / messaging; `chrome.action.openPopup` failed without an active browser window in headless-ish CFT).
- Real audio loudness / clipping perception by ear.
- Dynamic media insert observer path exercised only by architecture + code review (fixture has insert buttons; not clicked in CDP run).
- `prefers-reduced-motion` OS emulation not toggled in browser.
- DRM / cross-origin failure paths not demonstrated against Netflix/Spotify.

### Remaining risks

1. **Suspended AudioContext** — Boost may not be audible until the user clicks the page; UI reports “waiting” when status includes `suspended`.
2. **Iframe-only players** — Top-frame-only injection will not control media living solely in cross-origin iframes.
3. **Already-connected / DRM media** — `createMediaElementSource` failures surface as limited control; some sites remain uncontrollable.
4. **Toolbar popup vs extension tab** — Opening `popup.html` as a normal tab makes the active “tab” restricted; real toolbar popups bind to the prior active tab (normal Chrome behavior).
5. **Native volume snapshot** — Sites that mutate `element.volume` after hook may desync from the snapshot model in edge cases. Hooked path no longer rewrites `element.volume`; unhooked fallback preserves native `0`.
6. **Branded Chrome automation** — Developers on Chrome ≥137 need Chrome for Testing / Chromium or manual Load unpacked for CLI-driven tests.

---

## 7. Post-review defect fixes (second pass)

Three concrete defects found after the first implementation were fixed without expanding architecture.

### Defect 1 — Popup open always called `setVolume` (including default 100%)

**Problem:** `popup.js` init always ran `applyVolume(tab.id, savedVol)`, so opening the popup on a fresh tab at default 100% created `AudioContext`, hooked media, and could suspend/reroute playback solely because the popup opened.

**Fix (smallest honest protocol):**
- Content `getStatus` / status payloads now include explicit `started: boolean` (`false` + `code: 'NOT_STARTED'` when idle).
- Shared helpers: `isControllerStarted(status)`, `shouldReapplyOnOpen(savedPercent, status)`.
- Init probes only; re-applies when:
  - saved volume is **not** 100% (must reapply after page refresh), or
  - controller is **already** started (unity reapply / real reset path).
- Default 100% + never started → **no** `setVolume`, content stays fully lazy.

### Defect 2 — Native volume `0` coerced to `1`

**Problem:** `nativeSnap > 0 ? nativeSnap : 1` treated legitimate site/user native mute (`volume === 0`) as 1. Also had no-op `el.muted = el.muted`.

**Fix:**
- Hooked elements: do **not** rewrite `el.volume` or `el.muted` (gain multiplies media output).
- Unhooked fallback: `computeFallbackElementVolume(gain, nativeSnap)` preserves native `0`; at gain `1` restores the snapshot (including `0`).
- Static check guards ban the old ternary and the muted no-op.

### Defect 3 — Reset/preset flushes on failed `applyVolume`

**Problem:** `.then(() => { … })` ran even when `applyVolume` returned `null` (transport failure) or `{ ok: false }`, so reset could clear storage and set a normal badge after a failed apply. Same pattern risk on slider `change` / preset final flushes.

**Fix:**
- `isApplySuccess(result)` — requires a non-null object with `ok !== false`.
- Slider change / presets: `flushStorage` only after `isApplySuccess`.
- Reset: `persist: false`, then only on success cancel pending storage timer, `storage.local.remove`, and normal badge (no race that re-writes 100% after remove).
- `pagehide` flushes `confirmedVolume` only (never a failed requested value).
- `applyVolume` already limited schedule/badge to success; flushes now match.

### Files touched in this pass

- `volume-utils.js` — `isApplySuccess`, `isControllerStarted`, `shouldReapplyOnOpen`, `normalizeNativeVolume`, `computeFallbackElementVolume`
- `content.js` — `started` flag; native volume handling; remove muted no-op
- `popup.js` — lazy reapply gate; success-only flushes/reset cleanup
- `tests/volume-utils.test.js` — coverage for the above helpers
- `scripts/check.js` — static guards for native-0 coercion, muted no-op, `started` protocol, popup gates
- `PLAN_AND_IMPLEMENTATION.md` — this section

### Verification (this pass)

```text
npm test
# 43 tests, 13 suites, pass 43, fail 0
# (includes isApplySuccess, shouldReapplyOnOpen, native-0 fallback)

npm run check
# prior checks + native-0 / muted-no-op / started / shouldReapplyOnOpen / isApplySuccess guards
# check passed

npm run package
# dist-volume-booster-pro.zip with 11 runtime files at archive root
# volume-booster-pro.zip left untouched (Apr 22 2026 mtime preserved)

git diff --check
# exit 0 (no whitespace errors)

git status --short
# modified: PRIVACY.md README.md background.js content.js manifest.json
#           popup.css popup.html popup.js
# untracked: .gitignore PLAN_AND_IMPLEMENTATION.md package.json scripts/
#            tests/ volume-utils.js
# .DS_Store (Jun 6 2026) and volume-booster-pro.zip preserved on disk
```

**Protocol checks covered by unit tests + static guards (full CFT browser suite not re-run this pass):**
- `shouldReapplyOnOpen(100, { started: false, code: 'NOT_STARTED' }) === false`
- `shouldReapplyOnOpen(200, idle) === true` and `shouldReapplyOnOpen(0, idle) === true`
- `computeFallbackElementVolume(*, 0) === 0` for gains 0, 0.5, 1, 2
- `isApplySuccess(null) === false`, `isApplySuccess({ ok: false }) === false`, `isApplySuccess({ ok: true }) === true`

---

## 8. Popup UI rewrite — studio-rack control panel (2026-07-16)

### Why the previous UI was discarded

The prior popup was a generic dark SaaS card: navy surfaces, blue/violet gradients, a decorative circular progress ring, pill status chrome, and soft rounded “dashboard” cards. It read as AI-default template UI rather than a deliberate instrument. Hierarchy put ornament (the ring) ahead of the actual control surface, and the palette (cool blue + purple boost bands) reinforced that generic SaaS look. Polishing that layout would not have fixed the product feel.

### New visual architecture

Rebuilt from scratch as a **tactile hi-fi / studio-rack control panel** inspired by Braun industrial design and analog broadcast gear:

| Layer | Treatment |
| --- | --- |
| Chassis | Warm bone / off-white aluminum-like shell, hard edges (2–4px radii), CSS-only grain/scan texture, corner screw marks |
| Header | Condensed brand mark + dual LED cluster (power / signal) with state-driven green / amber / red |
| LCD zone | Near-black bezel + dominant tabular percentage readout; horizontal LCD meter (no circular ring) |
| Fader | Large tactile horizontal range control with channel groove, unity notch at 100%, capstan-style thumb |
| Preset bank | Five hardware-style memory switches (MUTE / NORM / BOOST / LOUD / MAX) with latched LED caps |
| Tab strip | Compact channel strip: favicon, title, domain, “CH” label |
| Caution | Amber/red hardware caution strip for high boost (not a soft alert card) |
| Footer | Quiet text utility reset + keyboard hint |

**Palette:** chassis bone, near-black LCD, fluorescent signal orange accent, tiny green/red LEDs. No glassmorphism, no blue/purple gradients, no floating cards, no pill-heavy dashboard, no remote fonts/CDNs.

**State hooks:** `data-state` (loading / ready / waiting / no-media / unavailable / error) and `data-band` (mute / normal / boost / high / max) drive LEDs, LCD color, meter fill, and switch engagement. High contrast, visible focus, ≥40px targets, `prefers-reduced-motion` honored.

**Geometry:** popup fixed at **380×540px**, `overflow: hidden`, no body scroll. Designed to fit Chrome’s popup chrome without clipping.

### Behavior preserved

All prior popup protocol remains: per-tab 0–600%, presets, status classification, restricted-page disable, success-only storage/badge, keyboard arrows, mute-0 storage, high-boost warning, lazy reapply via `shouldReapplyOnOpen`. Content/background scripts untouched.

### Files touched this pass

- `popup.html` — full rewrite (rack structure; ring markup removed)
- `popup.css` — full rewrite (studio-rack tokens + tactile controls)
- `popup.js` — remove `ringProgress` / `RING_C`; dual fill (LCD bar + fader channel); band label
- `scripts/check.js` — guards: no ring refs, 380px width, no glassmorphism, data-state/band hooks
- `PLAN_AND_IMPLEMENTATION.md` — this section

### Verification (this pass)

```text
npm test
npm run check
npm run package
git diff --check
# plus static confirm: 380px width, no body scroll, no external assets, no ringProgress/RING_C
```

---

## 9. Chrome Web Store asset kit — Signal Chassis (2026-07-16)

### Why

The rebuilt studio-rack popup (warm bone chassis, near-black LCD, fluorescent signal orange) made prior store icons, screenshots, and promo tiles obsolete. Store listing assets must match the product surface and remain deterministically regenerable.

### Visual movement

**Signal Chassis** (see `store-assets/DESIGN_PHILOSOPHY.md`): warm industrial material language, analog measurement precision, deliberate space, three-note palette (bone / charcoal / signal orange), sparse truthful typography, bold silhouettes for Chrome icon crops.

### Generator

`scripts/generate-store-assets.py` (Pillow + Playwright):

1. Draws original abstract speaker/fader logo master (1024²) and downscales store + runtime icons (128 / 16 / 32 / 48 / 128).
2. Renders the **real** `popup.html` + CSS + JS at 380×540 via Playwright with a deterministic mock `chrome` API (ready status, YouTube-like tab, saved volume 100 / 200 / 600).
3. Composes each capture into a 1280×800 marketing canvas (editorial product-photo language; three distinct layouts; no remote assets/fonts).
4. Builds optional promo tile 440×280.
5. Validates dimensions, modes, and non-zero files; programmatically checks 16px silhouette (bone + dark + orange present).

### Outputs

| Path | Size |
| --- | --- |
| `store-assets/DESIGN_PHILOSOPHY.md` | — |
| `store-assets/logo-master-1024.png` | 1024×1024 |
| `store-assets/store-icon-128.png` | 128×128 |
| `store-assets/screenshot-01-control-1280x800.png` | 1280×800 @ 100% ready |
| `store-assets/screenshot-02-boost-1280x800.png` | 1280×800 @ 200% ready |
| `store-assets/screenshot-03-max-1280x800.png` | 1280×800 @ 600% ready + caution |
| `store-assets/promo-tile-440x280.png` | 440×280 |
| `icons/icon{16,32,48,128}.png` | runtime icons from same master |

### Manifest

Description no longer says “compact dark control surface”; it names the tactile studio-rack control panel.

### Regenerate

```bash
# once: python3 -m venv .venv-assets && .venv-assets/bin/pip install pillow playwright
#       .venv-assets/bin/playwright install chromium
.venv-assets/bin/python scripts/generate-store-assets.py
```
