(function () {
  'use strict';

  const GTV = window.GTV;
  GTV.platform = GTV.platforms.tizen.available() ? GTV.platforms.tizen : GTV.platforms.browser;
  GTV.platform.init();

  GTV.data.loadConfig().then((config) => {
    GTV.config = config;
    GTV.start(document.getElementById('app'), config.startModule || 'home');
  });
})();
