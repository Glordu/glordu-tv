// Remote data: fetches JSON relative to the config URL and keeps the last good
// copy in localStorage, so the TV still works when GitHub Pages is unreachable.
(function () {
  'use strict';

  const GTV = window.GTV;
  const CACHE_PREFIX = 'gtv:cache:';
  const FALLBACK_CONFIG = { startModule: 'home', modules: {} };

  function queryParam(name) {
    const match = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return match ? decodeURIComponent(match[1]) : null;
  }

  const configUrl = new URL(queryParam('config') || GTV.settings.configUrl, window.location.href).href;

  // url -> { source: 'network' | 'cache' | 'none', at, error }
  const log = {};

  function readCache(url) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + url);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeCache(url, body) {
    try {
      localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ at: Date.now(), body: body }));
    } catch (err) {
      // Storage full or unavailable: the app still works, just without offline fallback.
    }
  }

  function fetchWithTimeout(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (controller) controller.abort();
    }, GTV.settings.fetchTimeoutMs);
    return fetch(url, { cache: 'no-cache', signal: controller ? controller.signal : undefined })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(
        (body) => {
          clearTimeout(timer);
          return body;
        },
        (err) => {
          clearTimeout(timer);
          throw err;
        }
      );
  }

  GTV.data = {
    configUrl: configUrl,
    log: log,

    // Resolve a path from the config (e.g. "images.json") against the config URL.
    resolve: function (path) {
      return new URL(path, configUrl).href;
    },

    // Network first, cached copy on failure. Rejects only if neither exists.
    fetchJson: function (url) {
      return fetchWithTimeout(url).then(
        (body) => {
          writeCache(url, body);
          log[url] = { source: 'network', at: Date.now() };
          return body;
        },
        (err) => {
          const cached = readCache(url);
          log[url] = {
            source: cached ? 'cache' : 'none',
            at: cached ? cached.at : null,
            error: String((err && err.message) || err),
          };
          if (cached) return cached.body;
          throw err;
        }
      );
    },

    loadConfig: function () {
      return GTV.data.fetchJson(configUrl).catch(() => FALLBACK_CONFIG);
    },
  };
})();
