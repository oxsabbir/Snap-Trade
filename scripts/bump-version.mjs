#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = join(root, 'app.json');
const pkgPath = join(root, 'package.json');

const SEMVER = /^\d+\.\d+\.\d+$/;
const KINDS = new Set(['major', 'minor', 'patch']);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function nextVersion(current, arg) {
  if (SEMVER.test(arg)) return arg;
  if (!KINDS.has(arg)) return null;
  const [major, minor, patch] = current.split('.').map(Number);
  if (arg === 'major') return `${major + 1}.0.0`;
  if (arg === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run bump <major|minor|patch|X.Y.Z>');
  process.exit(1);
}

const app = readJson(appPath);
const pkg = readJson(pkgPath);
const expo = (app.expo ??= {});

const current = typeof expo.version === 'string' ? expo.version : '';
if (!SEMVER.test(current)) {
  console.error(`app.json expo.version is not SemVer: "${current}"`);
  process.exit(1);
}

const next = nextVersion(current, arg);
if (!next) {
  console.error(`Invalid bump argument: "${arg}" (expected major|minor|patch or X.Y.Z)`);
  process.exit(1);
}

const prevCode = Number(expo.android?.versionCode) || 0;
const prevBuild = Number(expo.ios?.buildNumber) || 0;
const nextCode = prevCode + 1;
const nextBuild = String(prevBuild + 1);

expo.version = next;
expo.android = { ...(expo.android ?? {}), versionCode: nextCode };
expo.ios = { ...(expo.ios ?? {}), buildNumber: nextBuild };
pkg.version = next;

writeJson(appPath, app);
writeJson(pkgPath, pkg);

console.log(`version        ${current} -> ${next}`);
console.log(`android.versionCode  ${prevCode} -> ${nextCode}`);
console.log(`ios.buildNumber      ${prevBuild} -> ${nextBuild}`);
