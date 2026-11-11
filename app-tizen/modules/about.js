// About: version and where the remote data came from, for debugging on the TV.
(function () {
  'use strict';

  const GTV = window.GTV;

  function row(list, label, value) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.appendChild(dt);
    list.appendChild(dd);
  }

  function describe(entry) {
    const when = entry.at ? new Date(entry.at).toLocaleString() : 'never';
    if (entry.source === 'network') return 'live, fetched ' + when;
    if (entry.source === 'cache') return 'offline copy from ' + when + ' (' + entry.error + ')';
    return 'unavailable (' + entry.error + ')';
  }

  GTV.register({
    id: 'about',
    title: 'About',
    description: 'Version and data status',
    mount: function (el, ctx) {
      el.innerHTML = '<div class="about"><h1>About</h1><dl></dl><p class="hint">Back to return</p></div>';
      const list = el.querySelector('dl');
      row(list, 'Version', GTV.VERSION);
      row(list, 'Platform', ctx.platform.name);
      row(list, 'Config', ctx.data.configUrl);
      Object.keys(ctx.data.log).forEach((url) => {
        row(list, url.split('/').pop(), describe(ctx.data.log[url]));
      });
    },
  });
})();
