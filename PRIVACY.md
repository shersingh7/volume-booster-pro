# Privacy Policy — Volume Booster Pro

**Effective Date:** April 22, 2026

## Overview

Volume Booster Pro is a browser extension that boosts audio volume in web tabs. This privacy policy explains what data we collect (spoiler: none).

## Data Collection

**We do not collect, transmit, or share any user data.**

The extension operates entirely within your browser. Specifically:

- **No personal information** is collected
- **No browsing history** is collected
- **No audio content** is recorded or transmitted
- **No analytics** or tracking scripts are used
- **No remote servers** are contacted

## Local Storage

The only data stored is your **per-tab volume level** (e.g., "Tab #123 = 150%"). This is saved using Chrome's `chrome.storage.local` API and remains entirely on your device. It is:

- Never transmitted off your device
- Never synced to the cloud
- Automatically cleared when the tab closes

## Permissions Justification

| Permission | Why It's Needed |
|---|---|
| `activeTab` | To identify the currently active tab for volume control |
| `storage` | To remember volume levels locally per tab |
| `<all_urls>` | To inject the audio booster on any website with media |

## Third Parties

We do not integrate with any third-party services, APIs, or trackers.

## Changes

If this policy changes, the update will be reflected in the Chrome Web Store listing and this repository.

## Contact

For privacy questions, open an issue at:  
https://github.com/shersingh7/volume-booster-pro/issues
