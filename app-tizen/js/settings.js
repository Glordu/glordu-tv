// The only settings baked into the installed app. Everything else comes from
// the remote config, so it can change without reinstalling.
window.GTV = window.GTV || {};

GTV.settings = {
  // Entry point for all remote data, served by GitHub Pages from docs/.
  // In a browser you can override it with ?config=<url> for local testing.
  configUrl: 'https://glordu.github.io/glordu-tv/v1/config.json',

  // Give up on a request after this long and fall back to the cached copy.
  fetchTimeoutMs: 15000,
};
