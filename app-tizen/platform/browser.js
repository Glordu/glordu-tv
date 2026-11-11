// Desktop-browser adapter for development: keyboard stands in for the remote.
//   Arrows / Enter    remote arrows / OK
//   Esc / Backspace   Back
//   Space             Play/Pause
//   I                 Info
//   R G Y B           color keys
(function () {
  'use strict';

  const GTV = window.GTV;

  const KEYS = {
    ArrowLeft: 'LEFT',
    ArrowUp: 'UP',
    ArrowRight: 'RIGHT',
    ArrowDown: 'DOWN',
    Enter: 'ENTER',
    Escape: 'BACK',
    Backspace: 'BACK',
    ' ': 'PLAY_PAUSE',
    i: 'INFO',
    r: 'RED',
    g: 'GREEN',
    y: 'YELLOW',
    b: 'BLUE',
  };

  GTV.platforms.browser = {
    name: 'browser',
    available: function () {
      return true;
    },
    init: function () {},
    keyName: function (event) {
      if (event.ctrlKey || event.altKey || event.metaKey) return null;
      return KEYS[event.key] || null;
    },
    keepScreenOn: function () {},
    exit: function () {
      GTV.toast('Exit (only works on the TV)');
    },
  };
})();
