'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outName = 'dist-volume-booster-pro.zip';
const outPath = path.join(root, outName);

// Runtime files only — never touch the user's pre-existing volume-booster-pro.zip
const include = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'volume-utils.js',
  'content.js',
  'background.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

for (const rel of include) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    console.error('Missing required package file:', rel);
    process.exit(1);
  }
}

if (fs.existsSync(outPath)) {
  fs.unlinkSync(outPath);
}

// Use system zip; files at archive root (no nested project folder)
const r = spawnSync(
  'zip',
  ['-q', '-X', outName, ...include],
  { cwd: root, encoding: 'utf8' }
);

if (r.status !== 0) {
  console.error('zip failed:', r.stderr || r.stdout || r.error);
  process.exit(1);
}

const list = spawnSync('unzip', ['-l', outName], { cwd: root, encoding: 'utf8' });
if (list.status !== 0) {
  console.error('unzip -l failed:', list.stderr || list.stdout);
  process.exit(1);
}

console.log(list.stdout);

// Validate entries
const names = include.map((n) => n);
const listed = list.stdout;
for (const n of names) {
  if (!listed.includes(n)) {
    console.error('Package missing:', n);
    process.exit(1);
  }
}

// Reject nested duplicate project folder
if (/volume-booster-pro\//.test(listed)) {
  console.error('Package should not nest files under volume-booster-pro/');
  process.exit(1);
}

// Reject tests / git / docs from package
const banned = ['tests/', '.git', 'PLAN_AND_IMPLEMENTATION', 'node_modules', 'scripts/'];
for (const b of banned) {
  // crude line check: if a path column contains banned segment as package entry
  const lines = listed.split('\n').slice(3); // skip header
  for (const line of lines) {
    const m = line.trim().split(/\s+/);
    const name = m[m.length - 1] || '';
    if (name.includes(b)) {
      console.error('Package should not include:', name);
      process.exit(1);
    }
  }
}

console.log('Packaged:', outPath);
console.log('(Left existing volume-booster-pro.zip untouched if present.)');
