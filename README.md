# Volume Booster Pro

Manifest V3 Chrome extension that boosts page media volume up to **600%** with **per-tab** control. Compact dark control surface, honest status feedback, and a lazy content script that stays idle until you actually change volume.

## Features

- **0%–600% volume** via Web Audio API `GainNode` on `<audio>` / `<video>` elements
- **Per-tab levels** stored in `chrome.storage.local` (cleared when the tab closes)
- **Presets:** Mute 0%, Normal 100%, Boost 200%, Loud 400%, Max 600%
- **Status pill:** Ready, waiting for gesture, no media, unavailable, or error
- **High-boost warning** above 300% (clipping / distortion risk)
- **Keyboard:** ↑ / ↓ adjusts by 5% when focus is not on the range input
- **Efficient idle path:** no polling, no boot-time `AudioContext`, top frame only

## Install (Developer Mode)

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder

### Packaged zip

```bash
npm run package
```

Loads `dist-volume-booster-pro.zip` contents (or unzip and load the folder). Does not overwrite any pre-existing `volume-booster-pro.zip`.

## Development checks

Requires Node 18+.

```bash
npm test          # pure volume utility tests
npm run check     # manifest + JS syntax + efficiency guards
npm run package   # runtime-only zip at repo root
```

## How it works

```
Popup (UI)
  → chrome.tabs.sendMessage
Content script (top frame, lazy)
  → Web Audio API GainNode → destination
```

1. Content script registers a message listener only at load.
2. On first `setVolume`, it creates an `AudioContext`, hooks existing media once, and starts a `MutationObserver` for added nodes only.
3. At 100% (normal), discovery work is stopped when safe; already-routed elements keep their graph so playback stays correct.
4. Suspended contexts install temporary gesture listeners until `resume()` succeeds.

### Architecture limits (honest)

| Situation | Behavior |
|---|---|
| Gain &gt; 1.0 | Can **clip / distort**; not “distortion-free” |
| DRM media (e.g. some Netflix / Spotify Web paths) | Often **cannot** be hooked |
| Cross-origin media without CORS | `createMediaElementSource` may fail; status reports limited control |
| Restricted pages (`chrome://`, Web Store, …) | Popup shows **Unavailable**; controls disabled |
| Autoplay / suspended `AudioContext` | May need a **click on the page** first |
| Iframes | Top frame only (avoids multi-graph / multi-observer cost) |

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Identify the active tab for messaging and UI |
| `storage` | Remember per-tab volume locally |
| `<all_urls>` host permission | Inject the content script on arbitrary sites with media — core product function |

No analytics, remote code, or network calls from the extension UI (local system fonts only).

## Project layout

```
├── manifest.json
├── popup.html / popup.css / popup.js
├── volume-utils.js      # shared pure helpers (popup + tests)
├── content.js           # lazy audio controller
├── background.js        # badge + storage cleanup
├── icons/
├── tests/
├── scripts/check.js
├── scripts/package.js
└── package.json
```

## Privacy

See [PRIVACY.md](PRIVACY.md). Volume preferences stay on-device; nothing is transmitted.

## License

MIT
