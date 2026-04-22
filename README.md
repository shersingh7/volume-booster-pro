# Volume Booster Pro

A premium Chrome extension with liquid glass UI that boosts audio up to 600% with per-tab control.

## Features

- **Liquid Glass UI** — Frosted glass panels with ambient glows, backdrop blur, and smooth gradients
- **0% to 600% Volume Boost** — Uses Web Audio API gain nodes for distortion-free amplification
- **Per-Tab Control** — Each tab has its own independent volume level
- **Quick Presets** — Mute, Normal, Boost (200%), Max (400%) with one click
- **Keyboard Shortcuts** — Arrow Up/Down to adjust volume directly
- **Live Ring Visualization** — Animated SVG ring shows current level
- **Active Tab Info** — Shows favicon, title, and domain of the current tab
- **Responsive Design** — Works smoothly at all popup sizes

## Install (Developer Mode)

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `volume-booster-pro` folder

## Files

```
volume-booster-pro/
├── manifest.json       # Extension manifest v3
├── popup.html          # Main popup UI
├── popup.css           # Liquid glass styles
├── popup.js            # Popup logic & chrome APIs
├── content.js          # Injected page script (Web Audio API)
├── background.js       # Service worker
├── icons/              # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## How It Works

The extension uses the **Web Audio API** to create a `GainNode` that intercepts audio/video element sources. This allows boosting volume beyond the browser's 100% limit without clipping, unlike simple `element.volume` manipulation.

### Architecture

```
Popup (UI Layer)
  ↓ chrome.tabs.sendMessage
Content Script (Page Layer)
  ↓ Web Audio API
GainNode → AudioDestination
```

## Permissions

- `activeTab` — Access current tab for volume control
- `storage` — Persist per-tab volume levels
- `<all_urls>` — Inject content script on all websites

## Notes

- Some sites (Spotify Web, Netflix) use DRM-protected audio that cannot be intercepted
- First user interaction (click/keypress) may be required to unlock AudioContext (browser policy)
- Boosting beyond 300% may cause distortion on low-quality audio sources

## License

MIT
