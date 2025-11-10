#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crossZip = require('cross-zip');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const bundleDir = path.join(distDir, 'tagalyst2');
const zipPath = path.join(distDir, 'tagalyst2.zip');

const entries = [
  'manifest.json',
  'content',
  'options',
  'icons',
  'README.md'
];

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(bundleDir, { recursive: true });

for (const entry of entries) {
  const src = path.join(root, entry);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(bundleDir, entry);
  fs.cpSync(src, dest, { recursive: true });
}

crossZip.zipSync(bundleDir, zipPath);

console.log(`Extension bundle created at ${zipPath}`);
