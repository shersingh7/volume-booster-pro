'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const jsFiles = [
  'volume-utils.js',
  'popup.js',
  'content.js',
  'background.js',
  'scripts/check.js',
  'scripts/package.js',
  'tests/volume-utils.test.js'
];

let failed = false;

function fail(msg) {
  console.error('FAIL:', msg);
  failed = true;
}

function ok(msg) {
  console.log('OK:  ', msg);
}

// Manifest parse + shape
const manifestPath = path.join(root, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ok('manifest.json parses as JSON');
} catch (e) {
  fail('manifest.json is not valid JSON: ' + e.message);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  fail('manifest_version must be 3');
} else {
  ok('manifest_version is 3');
}

if (!manifest.version || typeof manifest.version !== 'string') {
  fail('manifest.version missing');
} else {
  ok('manifest.version = ' + manifest.version);
}

if (!manifest.background || !manifest.background.service_worker) {
  fail('background.service_worker required');
} else {
  ok('service_worker: ' + manifest.background.service_worker);
}

const cs = manifest.content_scripts && manifest.content_scripts[0];
if (!cs || !Array.isArray(cs.js) || !cs.js.includes('content.js')) {
  fail('content_scripts must include content.js');
} else {
  ok('content_scripts includes content.js');
  if (cs.all_frames === true) {
    fail('all_frames should be false/omitted for efficiency (top frame only)');
  } else {
    ok('all_frames is not permanently enabled');
  }
}

// node --check on JS
for (const rel of jsFiles) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    fail('missing file: ' + rel);
    continue;
  }
  const r = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (r.status !== 0) {
    fail('syntax: ' + rel + '\n' + (r.stderr || r.stdout));
  } else {
    ok('syntax: ' + rel);
  }
}

// Static efficiency / correctness guards on content.js
const contentSrc = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
if (/\bsetInterval\s*\(/.test(contentSrc)) {
  fail('content.js must not use setInterval');
} else {
  ok('content.js has no setInterval');
}

// Native volume 0 must not be coerced to 1 (historical bug: nativeSnap > 0 ? … : 1)
if (/nativeSnap\s*>\s*0\s*\?/.test(contentSrc) || /nativeSnap\s*>\s*0\s*\?\s*nativeSnap\s*:\s*1/.test(contentSrc)) {
  fail('content.js must not coerce native volume 0 to 1');
} else {
  ok('content.js does not coerce native volume 0 to 1');
}

if (/el\.muted\s*=\s*el\.muted/.test(contentSrc)) {
  fail('content.js has no-op el.muted = el.muted');
} else {
  ok('content.js has no muted no-op');
}

// Protocol: getStatus must report started for lazy popup open
if (!/started:\s*false/.test(contentSrc) || !/started:\s*true/.test(contentSrc)) {
  fail('content.js status protocol must include started: true/false');
} else {
  ok('content.js status reports started flag');
}

const popupSrc = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
if (!/shouldReapplyOnOpen/.test(popupSrc)) {
  fail('popup.js must gate init apply via shouldReapplyOnOpen');
} else {
  ok('popup.js uses shouldReapplyOnOpen for lazy init');
}
if (!/isApplySuccess/.test(popupSrc)) {
  fail('popup.js must guard storage/badge flushes with isApplySuccess');
} else {
  ok('popup.js guards flushes with isApplySuccess');
}

// Ensure popup does not load remote fonts
const cssPath = path.join(root, 'popup.css');
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8');
  if (/@import\s+url\s*\(\s*['"]?https?:/i.test(css) || /fonts\.googleapis/i.test(css)) {
    fail('popup.css must not load remote fonts');
  } else {
    ok('popup.css has no remote font import');
  }
}

// popup.html should load volume-utils before popup.js
const htmlPath = path.join(root, 'popup.html');
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const utilsIdx = html.indexOf('volume-utils.js');
  const popupIdx = html.indexOf('popup.js');
  if (utilsIdx === -1 || popupIdx === -1 || utilsIdx > popupIdx) {
    fail('popup.html must load volume-utils.js before popup.js');
  } else {
    ok('popup.html script order');
  }
  if (/fonts\.googleapis|cdn\.|unpkg\.|jsdelivr/i.test(html)) {
    fail('popup.html must not reference remote scripts/fonts');
  } else {
    ok('popup.html has no remote assets');
  }
}

if (failed) {
  console.error('\ncheck failed');
  process.exit(1);
}
console.log('\ncheck passed');
