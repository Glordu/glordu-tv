// The deploy script's details: which TV, which app id, and the package name
// (a space in it made the TV's installer fail without saying so).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appIdIn, pickDevice, renamePackage, PACKAGE } from '../scripts/deploy-tv.mjs';

const devices = (...lines) => ['List of devices attached ', ...lines, ''].join('\n');

test('uses the only connected TV', () => {
  const out = devices('192.168.0.67:26101     device          UE55AU7172UXXH');
  assert.equal(pickDevice(undefined, out), 'UE55AU7172UXXH');
});

test('ignores TVs that are offline or not yet authorized', () => {
  const out = devices(
    '192.168.0.50:26101     offline         OldTV',
    '192.168.0.67:26101     device          UE55AU7172UXXH',
    'emulator-26101         unauthorized    Emulator'
  );
  assert.equal(pickDevice(undefined, out), 'UE55AU7172UXXH');
});

test('with no TV, or more than one, asks for a name instead of guessing', () => {
  assert.throws(() => pickDevice(undefined, devices()), /found 0.*sdb connect/);
  const two = devices('a:26101  device  TV1', 'b:26101  device  TV2');
  assert.throws(() => pickDevice(undefined, two), /found 2/);
  assert.equal(pickDevice('TV2', two), 'TV2', 'a named device wins');
});

test('handles Windows line endings', () => {
  assert.equal(pickDevice(undefined, devices('x:26101\tdevice\tTV1').replace(/\n/g, '\r\n')), 'TV1');
});

test('reads the app id from config.xml', () => {
  const xml = fs.readFileSync(new URL('../app-tizen/config.xml', import.meta.url), 'utf8');
  assert.equal(appIdIn(xml), 'glordutv01.GlorduTV');
  assert.throws(() => appIdIn('<widget/>'), /No tizen:application id/);
});

test('renames the built package to a name without spaces', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtv-deploy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Glordu TV.wgt'), 'pkg');
  fs.writeFileSync(path.join(dir, 'author-signature.xml'), '');
  assert.equal(renamePackage(dir), path.join(dir, PACKAGE));
  assert.doesNotMatch(PACKAGE, /\s/);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.wgt')), [PACKAGE]);
  assert.equal(fs.readFileSync(path.join(dir, PACKAGE), 'utf8'), 'pkg');
  renamePackage(dir); // already named: left alone
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.wgt')), [PACKAGE]);
});

test('refuses to guess between several built packages', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtv-deploy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.wgt'), '');
  fs.writeFileSync(path.join(dir, 'b.wgt'), '');
  assert.throws(() => renamePackage(dir), /found 2/);
});
