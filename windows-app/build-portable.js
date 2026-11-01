#!/usr/bin/env node
/*
 * Builds the portable folder: <this directory>\Superagent\
 *
 * Steps:
 *   1. copy node_modules/electron/dist/*  -> Superagent\
 *   2. copy our app files (package.json, main.js, icon.png) -> Superagent\resources\app\
 *   3. remove resources\default_app.asar
 *   4. rename electron.exe -> Superagent.exe
 *
 * No installer, no admin. Run with: node build-portable.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'Superagent');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

const APP_FILES = ['package.json', 'main.js', 'preload.js', 'instances-window.js', 'icon.png', 'icon.ico'];

function die(msg) {
  console.error('BUILD FAILED: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(DIST)) die('missing ' + DIST + ' — run: npm.cmd install electron --allow-scripts=electron');
for (const f of APP_FILES) {
  if (!fs.existsSync(path.join(ROOT, f))) die('missing app file ' + f);
}

console.log('Copying Electron dist...');
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(DIST, OUT, { recursive: true });

const appDir = path.join(OUT, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const f of APP_FILES) {
  fs.copyFileSync(path.join(ROOT, f), path.join(appDir, f));
}

const defaultAsar = path.join(OUT, 'resources', 'default_app.asar');
if (fs.existsSync(defaultAsar)) fs.rmSync(defaultAsar, { force: true });

const oldExe = path.join(OUT, 'electron.exe');
const newExe = path.join(OUT, 'Superagent.exe');
if (!fs.existsSync(oldExe)) die('missing ' + oldExe);
fs.renameSync(oldExe, newExe);

// Keep the shipped license/version files next to the exe.
console.log('Portable app built: ' + newExe);
console.log('App payload:        ' + appDir);
