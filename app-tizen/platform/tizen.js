// Samsung Tizen adapter. Everything Tizen-specific lives here so the rest of
// the app can move to another platform by swapping this file.
(function () {
  'use strict';

  const GTV = window.GTV;

  const KEYS = {
    37: 'LEFT',
    38: 'UP',
    39: 'RIGHT',
    40: 'DOWN',
    13: 'ENTER',
    10009: 'BACK',
    10252: 'PLAY_PAUSE',
    415: 'PLAY',
    19: 'PAUSE',
    417: 'FAST_FORWARD',
    412: 'REWIND',
    403: 'RED',
    404: 'GREEN',
    405: 'YELLOW',
    406: 'BLUE',
    457: 'INFO',
    65376: 'ENTER', // on-screen keyboard: Done
    65385: 'CANCEL', // on-screen keyboard: Cancel
  };

  // Keys beyond arrows/OK/Back only reach the app once registered.
  const REGISTER = [
    'MediaPlayPause',
    'MediaPlay',
    'MediaPause',
    'MediaFastForward',
    'MediaRewind',
    'ColorF0Red',
    'ColorF1Green',
    'ColorF2Yellow',
    'ColorF3Blue',
    'Info',
  ];

  let wantScreenOn = false;

  function applyScreenSaver() {
    try {
      const appcommon = window.webapis.appcommon;
      const state = appcommon.AppCommonScreenSaverState;
      appcommon.setScreenSaver(
        wantScreenOn ? state.SCREEN_SAVER_OFF : state.SCREEN_SAVER_ON,
        () => {},
        (err) => console.warn('setScreenSaver failed', err)
      );
    } catch (err) {
      console.warn('setScreenSaver unavailable', err);
    }
  }

  GTV.platforms.tizen = {
    name: 'tizen',

    available: function () {
      return typeof window.tizen !== 'undefined';
    },

    init: function () {
      REGISTER.forEach((key) => {
        try {
          window.tizen.tvinputdevice.registerKey(key);
        } catch (err) {
          console.warn('Could not register key', key, err);
        }
      });
      // The TV resets the screensaver setting when the app is backgrounded.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) applyScreenSaver();
      });
    },

    keyName: function (event) {
      return KEYS[event.keyCode] || null;
    },

    // Stop the TV's own screensaver from covering the app while `on` is true.
    keepScreenOn: function (on) {
      wantScreenOn = on;
      applyScreenSaver();
    },

    exit: function () {
      window.tizen.application.getCurrentApplication().exit();
    },
  };
})();
