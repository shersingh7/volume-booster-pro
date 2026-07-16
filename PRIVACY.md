# Privacy Policy — Volume Booster Pro

**Effective Date:** April 22, 2026
**Last Updated:** July 16, 2026

## Overview

Volume Booster Pro is a browser extension that adjusts audio volume in web tabs. This privacy policy explains what data we collect (spoiler: none leave your device).

## Data Collection

**We do not collect, transmit, or share any user data.**

The extension operates entirely within your browser:

- **No personal information** is collected
- **No browsing history** is collected or uploaded
- **No audio content** is recorded or transmitted
- **No analytics** or tracking scripts are used
- **No remote servers** are contacted by the extension
- **No remote fonts or CDNs** are loaded by the popup

## Local Storage

The only data stored is your **per-tab volume level** (for example, tab id → `150`). This uses Chrome’s `chrome.storage.local` API and remains on your device. It is:

- Never transmitted off your device
- Never synced by this extension to a developer-controlled server
- Removed when the tab closes (via the extension service worker)

## Permissions Justification

| Permission | Why It's Needed |
|---|---|
| `activeTab` | Identify the currently active tab for volume control and UI |
| `storage` | Remember volume levels locally per tab |
| `<all_urls>` | Inject the content script on websites that play media so gain can be applied |

## Third Parties

We do not integrate with third-party analytics, ads, or APIs. Media on web pages may still load from third-party hosts as part of normal browsing; the extension does not proxy or upload that media.

## Changes

If this policy changes, the update will be reflected in the Chrome Web Store listing and this repository.

## Contact

For privacy questions, open an issue at:  
https://github.com/shersingh7/volume-booster-pro/issues
