// The TV adapter: remote key codes, key registration and the screensaver.
// Codes come from Samsung's docs and testing on the TV; a wrong one leaves a
// button dead with no error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, plain } from './helpers/app.mjs';

// A fake TV: records registered keys and screensaver calls.
function tv() {
  const registered = [];
  const screenSaver = [];
  const win = loadApp(['platform/tizen.js'], {
    GTV: { platforms: {} },
    tizen: {
      tvinputdevice: { registerKey: (k) => registered.push(k) },
      application: { getCurrentApplication: () => ({ exit: () => (win.exited = true) }) },
    },
    webapis: {
      appcommon: {
        AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 },
        setScreenSaver: (state) => screenSaver.push(state ? 'on' : 'off'),
      },
    },
  });
  const p = win.GTV.platforms.tizen;
  return { win, p, registered, screenSaver };
}

test('remote key codes map to the app\'s key names', () => {
  const { p } = tv();
  const expected = {
    37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN', 13: 'ENTER',
    10009: 'BACK',
    10252: 'PLAY_PAUSE', 415: 'PLAY', 19: 'PAUSE', 417: 'FAST_FORWARD', 412: 'REWIND',
    403: 'RED', 404: 'GREEN', 405: 'YELLOW', 406: 'BLUE', 457: 'INFO',
  };
  for (const [code, name] of Object.entries(expected)) {
    assert.equal(p.keyName({ keyCode: Number(code) }), name, 'key code ' + code);
  }
  assert.equal(p.keyName({ keyCode: 12345 }), null, 'unknown keys are ignored');
});

test('the on-screen keyboard\'s Done confirms and Cancel cancels', () => {
  const { p } = tv();
  assert.equal(p.keyName({ keyCode: 65376 }), 'ENTER');
  assert.equal(p.keyName({ keyCode: 65385 }), 'CANCEL');
});

test('media and color keys are registered, or they never reach the app', () => {
  const { p, registered } = tv();
  assert.ok(p.available());
  p.init();
  assert.deepEqual(plain(registered).sort(), [
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info',
    'MediaFastForward', 'MediaPause', 'MediaPlay', 'MediaPlayPause', 'MediaRewind',
  ]);
});

test('the screensaver stays off while asked, and is set again when the app comes back', () => {
  const { win, p, screenSaver } = tv();
  p.init();
  p.keepScreenOn(true);
  assert.deepEqual(plain(screenSaver), ['off']);
  // The TV resets it while the app is in the background.
  win.document.hidden = true;
  win.dispatch('visibilitychange');
  assert.deepEqual(plain(screenSaver), ['off'], 'nothing to do while hidden');
  win.document.hidden = false;
  win.dispatch('visibilitychange');
  assert.deepEqual(plain(screenSaver), ['off', 'off']);
  p.keepScreenOn(false);
  win.dispatch('visibilitychange');
  assert.deepEqual(plain(screenSaver), ['off', 'off', 'on', 'on']);
});

test('without webapis, keepScreenOn warns instead of throwing', () => {
  const win = loadApp(['platform/tizen.js'], {
    GTV: { platforms: {} },
    console: { warn: () => (win.warned = true), log() {} },
  });
  assert.doesNotThrow(() => win.GTV.platforms.tizen.keepScreenOn(true));
  assert.ok(win.warned);
  assert.equal(win.GTV.platforms.tizen.available(), false, 'not a TV without window.tizen');
});

test('exit closes the app', () => {
  const { win, p } = tv();
  p.exit();
  assert.ok(win.exited);
});
