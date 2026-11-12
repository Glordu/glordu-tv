# glordu-tv

Personal TV app. It starts as a full-screen photo slideshow with a clock, a
replacement for the Chromecast backdrop that runs on the TV itself, and has
room for more modules (small tools) later.

```
app-tizen/   the Samsung (Tizen) app: an HTML/JS package installed on the TV
docs/        remote data, served by GitHub Pages
  v1/        config.json (the one URL the app knows) and images.json
scripts/     maintenance: rebuild images.json, back up photos, local server
```

## How it fits together

- The installed app knows only one URL, `https://glordu.github.io/glordu-tv/v1/config.json`
  (`app-tizen/js/settings.js`). Everything else (which module starts, slideshow
  timing, the images list) is in that config, so changing the data or settings
  in `docs/` reaches the TV without reinstalling.
- Each JSON file the app reads is cached on the TV, so it keeps working with
  the last good copy if GitHub Pages is unreachable.
- The data lives under `v1/`. If you change the format in a way older app
  builds can't read, publish it under `v2/` and update `configUrl`. The TV keeps
  reading `v1/` until you reinstall.
- Everything here is public (free GitHub Pages needs a public repo). Never put
  API keys or tokens in `docs/`.

### Platform split

Everything Tizen-specific is in `app-tizen/platform/tizen.js`: remote key
codes, the TV screensaver, and exiting the app. `config.xml` handles packaging
and permissions. The rest of the code is plain HTML/JS. To port the app to
another TV (webOS, or an Android TV WebView), move the shared code into a
`shared/` folder and add an `app-<platform>/` folder with its own adapter.

The TV's browser engine is an older Chromium. Use classic `<script>` tags, not
ES modules (the package is served from `file://`). Avoid `?.`, `??`, and
flexbox `gap`.

### Pages and the remote

Each module is a page, stacked vertically: Slideshow, Weather, Settings
(`config.pages` can change the order).

- **▲ ▼** slide to the previous / next page. Past the first or last page
  the stack bounces back; dots on the right edge show where you are.
- **◀ ▶** act inside the page: photo, day, or the setting's value.
- **Back** first resets the page (Weather to today, Settings to the first
  setting, closing the city search), then returns to the Slideshow. On the
  Slideshow, Back shows "Press Back again to exit" and a second press within
  2 seconds exits.
- After `config.idleReturnMinutes` (default 5) without a key press on
  another page, the app slides back to the Slideshow, which only changes
  photos while it's showing.

A module is one file in `app-tizen/modules/` that calls `GTV.register(...)`.
Add its `<script>` tag to `index.html`. See `js/core.js` for the interface.
Its settings come from `modules.<id>` in `config.json`.

| Module    | What it does |
|-----------|--------------|
| `ambient` | Photo slideshow with weather and clock in the bottom-right corner. ◀ ▶: previous/next photo. OK: favorite or unfavorite the photo (a heart fills or empties at top-right). Play/Pause: pause. Info: hide the clock and weather. Favorites are saved on the TV and get extra turns between the other photos: each comes back about once every 100 photos, and together they never take more than a quarter of the turns, so every photo still shows once per pass. |
| `weather` | Current weather (with "feels like") and the clock at the top, the selected day's high/low, rain, wind and sun times beside them, a row of 6 hours (temperature line, icon, chance of rain), and the week's day strip. The page opens on the strip: ◀ ▶ change day (at the current time of day), ▲ moves to the hours row, where ◀ ▶ step an hour at a time across midnight into other days. Back returns to now. Range: 4 weeks back to the end of the 16-day forecast; past hours show the rain that fell. The temperature line is scaled per strip week, so equal temperatures sit at equal heights. |
| `settings` | Location, time zone, temperature units and clock format, saved on the TV; the problem log (OK on Log); an About section (version, location source, resolution, where each data file came from). ▲ ▼ move through the settings and only leave the page past the first or last one. |

`design/` holds the interactive mockups the layouts were chosen from (open
them through `npm run serve`): `mockup.html` for the page stack (made-up
numbers), `hourly-rain.html` and `hourly-scroll.html` for the Weather page
(live forecast), `hearts.html` for the favorite heart (photos from `backup/`).

### Settings

Choices made in Settings are stored on the TV (`localStorage`, see
`js/prefs.js`), never in the public `config.json`.

- **Location** (`js/location.js`): *Automatic* by default, looked up once a day
  from the TV's internet address via [GeoJS](https://www.geojs.io/), with
  [ipwho.is](https://ipwho.is/) as backup. Both are free and keyless, and each
  sees the TV's IP address. Press OK to search for a city instead
  ([Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api)) using
  the TV's on-screen keyboard. ◀▶ switches between automatic and the chosen
  city. If detection fails, the `weather` section of `config.json` is used.
- **Time zone** (`js/clock.js`): *TV setting* (default; the TV's own clock), *Same as
  location*, or a zone from a short list.
- **Temperature** °C/°F and **Clock** 24-hour/12-hour override `config.json`.
- **Log**: the problem log (below). OK opens it, newest first; ▲▼ scroll.

While a text field has focus, only OK, Back and ▲▼ reach the app; other keys
type into the field. The keyboard's Done and Cancel keys (65376, 65385) are
mapped in `platform/tizen.js`.

### Weather

`js/weather.js` is shared by any module that wants weather. One request every
30 minutes returns current conditions plus daily weather from 4 weeks ago to
16 days ahead (about 2 KB), for the location from Settings; the slideshow
corner and the Weather page both read it. Data comes from [Open-Meteo](https://open-meteo.com/),
which is free for personal use and needs no API key, so nothing secret goes in
this public repo. `config.json` holds defaults:

```json
"weather": { "name": "London", "timezone": "Europe/London", "latitude": 51.51, "longitude": -0.13, "units": "celsius", "refreshMinutes": 30 }
```

The icons are Google's filled Material Symbols (Apache 2.0), inlined in
`weather.js` so the TV never fetches them.

`config.json` is public, so keep its fallback location to city level (two
decimals at most), never your exact address. Readings older than 3 hours, for
example from the offline cache, are hidden rather than shown stale.

### Missing photos

The slideshow loads each photo off-screen and only crossfades to it once it
has fully loaded. If a link is dead, or returns a small "unavailable"
placeholder (under 640px wide), the current photo stays up, the bad one is
skipped for the rest of the round, and the next one is tried. After 10
failures in a row (no network, say) it keeps the current photo and retries a
minute later. Dead links are listed in the log once a later photo loads;
a run of 10 failures is logged as one line instead.

### Log

`js/log.js` keeps the last 100 warnings, errors and app starts in the TV's
`localStorage` (`gtv:log`), so they outlive a crash or restart. It loads
before every other script and records `console.warn`/`console.error`,
uncaught errors, unhandled promise failures and scripts that fail to load;
the same message twice in a row is counted rather than repeated. Failed
fetches (and whether the saved copy was used) and dead photo links are logged
too.

If the app fails to start, the error replaces "Loading…" on screen, and so
does a start that hasn't happened after a minute. To read the whole log from
the PC, even when Settings can't be reached:

```bash
npm run log
```

`scripts/tv-log.mjs` reads it through the TV's debugger (relaunching the app
in debug mode if needed), so it only needs the page to load; `-- --clear`
empties it afterwards.

## Photos

`docs/v1/images.json` lists photos from two sources. Each entry has its `url`,
the photographer (`author`), a short `source` tag, and when it was `added` to
the list (ISO timestamp); the top-level `sources` maps each tag to its URL.

- **`dconnolly-archive`**: the 2019 [Chromecast backgrounds archive](https://github.com/dconnolly/chromecast-backgrounds).
  Its links are dying: in November 2026, 403 of the 702 still worked.
- **`chromecast-feed`**: Google's current Chromecast backdrop feed
  (`clients3.google.com/cast/chromecast/home`), which returns ~49 random
  photos per load from a pool of about 400. 405 harvested in November 2026.
  Listed at 1920×1080; the same links serve the 4K originals with `=s0`.

The list links to Google's servers rather than hosting the photos, which
belong to their photographers. The app only reads `url`; the other fields
are for us (the author isn't displayed).

```bash
npm run harvest  # add new photos from the Chromecast feed, drop dead ones
npm run images   # re-check the archive's URLs; harvested photos are kept
                 # (Google rate-limits after many requests; those are kept, not dropped)
npm run backup   # download every listed photo to ./backup (gitignored)
```

Whether the feed's links expire is not known yet; re-running `npm run harvest`
drops any that stopped working and picks up new ones.

**Not used yet:** [luke.lol's Chromecast gallery](https://luke.lol/chromecast.php)
has 1,283 Chromecast photos (755 current, 451 old, 77 archive, as of November
2026), likely including a few hundred we don't have, among them photos whose
Google links died. It hosts its own copies (`/chromecast/<id>/base` at
1920×1080, `/max` for originals) and an RSS feed with photographer credits,
but no Google links, so using it would mean downloading once and serving the
photos ourselves rather than loading them from that personal site.

Photos removed on purpose are listed, with the reason, in
`scripts/excluded-photos.json`; both scripts skip them so they don't come back.
So far that's two duplicates (the same picture under two links), found by
comparing perceptual fingerprints of the backed-up photos; no photo appears in
both sources.

The backup is safe to re-run; it skips files it already has. `backup/index.json`
maps each file to its original URL and photographer. If the links go dark,
serve the backup from your home network or bundle it into the app, and point
`modules.ambient.images` at the new list.

## Performance on the TV

The TV draws pixels in software on a slow CPU, so what's cheap on a PC can
be very slow there. Measured with the tools below:

- **No CSS gradients on large areas.** One full-screen gradient cost about
  5 s of raster work per page slide (a 1.3 s freeze). The backgrounds are
  small pre-drawn images instead (`scripts/make-backgrounds.mjs`), which cost
  about the same as a solid color.
- Pages slide one pair at a time, each on its own layer only while moving
  (`slidePages` in `js/core.js`); keys update only what changed.

Tools:

- **Yellow key**: on-screen readout of key → frame time and the frame rate of
  the last slide.
- **`scripts/tv-trace.mjs`**: drives the app through the TV's debugger and
  reports raster time and main-thread stalls per key press; it can also inject
  CSS live to try a change before deploying. Setup is in its header.

## Tests

```bash
npm test
```

Node's built-in test runner, no dependencies. `test/` covers the logic that
has broken or easily could:

| File | Covers |
|---|---|
| `core.test.mjs` | the page stack: moving and bouncing, keys going to the page first, the Back sequence and exit window, the idle return, typing in text fields, the Yellow-key readout |
| `ambient.test.mjs` | the slideshow loop: wrapping, reshuffling, skipping dead photos, carrying on across restarts and list changes |
| `favorites.test.mjs` | favorites' extra turns: 1% each up to a quarter, taking turns evenly, the loop unchanged, ◀ from a favorite, dead or removed favorites, carrying on across restarts |
| `ambient-display.test.mjs` | the slideshow on screen: the interval, pausing while hidden, OK showing the heart and saving the favorite, remote presses restarting the interval, instant vs faded swaps, placeholders never showing, the retry after repeated failures, dead links in the log |
| `location.test.mjs` | chosen city vs automatic vs config fallback; GeoJS, then ipwho.is, then an old guess; the lookup race when choosing a city; caching |
| `weather.test.mjs` | grouping hours under days (including 23-hour daylight-saving days), parsing, hiding stale readings |
| `services.test.mjs` | remote data and its offline copy, including after the 15 s timeout, and failures in the log; the clock's formats and time zones; the weather request's units and rounded location |
| `forecast.test.mjs` | the Weather page: day strip and hours row, day changes landing on now, Back, now moving with the clock, only ~18 hour columns in the page |
| `settings.test.mjs` | Settings rows and leaving the page at the edges, Back, changing values, the city search, the Log row and scrolling the log |
| `log.test.mjs` | the problem log: what it records, counting repeats, the 100-entry limit, surviving restarts, a failed or stuck start shown on screen |
| `scripts.test.mjs` | the Chromecast feed parser (with Google's double escaping) and merging photo lists (tags, dates, exclusions) |
| `rate-limit.test.mjs` | the scripts' link checks: a rate-limited (429) photo is retried and kept, never dropped |
| `deploy.test.mjs` | picking the TV from `sdb devices`, the app id, renaming the package to `GlorduTV.wgt` |
| `tv-log.test.mjs` | reading the log from the TV: the debug port, printing entries, whether the app started |
| `tizen.test.mjs` | the TV's remote key codes (including the on-screen keyboard's Done and Cancel), key registration, the screensaver being set again on return |
| `data-files.test.mjs` | the published `images.json` and `config.json`: links, no repeats, known sources, valid dates, no excluded photos, the fields the app reads |

App files are browser scripts, so `test/helpers/app.mjs` runs them in a
sandbox with a fake DOM, storage and network. Looks and TV performance stay
manual (browser preview, the Yellow-key readout, `scripts/tv-trace.mjs`).

## Try it in a browser

```bash
npm run serve
```

Open http://localhost:8080/. It reads `docs/` locally instead of from GitHub
Pages. Keyboard stands in for the remote: arrows, Enter, Esc (Back),
Space (Play/Pause), I (Info).

## Publish the data (once)

1. Create a **public** GitHub repo named `glordu-tv` and push this repo to it.
2. Repo **Settings → Pages**: Source "Deploy from a branch", branch `main`, folder `/docs`.
3. Check that https://glordu.github.io/glordu-tv/v1/config.json loads.

If the repo lives under a different account or name, update `configUrl` in
`app-tizen/js/settings.js` before building.

## Install on the TV

You need to do this once per PC, plus a reinstall whenever `app-tizen/` changes.
These steps have not been run against the TV yet.

### 1. Developer Mode on the TV

1. Note your PC's local IP (`ipconfig`, IPv4 address).
2. On the TV open **Apps**, then type `1 2 3 4 5`. The Smart Remote's on-screen
   number pad doesn't register on this TV; use the number pad of the
   **SmartThings** phone app's remote instead.
3. Switch **Developer mode** to On, enter the PC's IP, and confirm.
4. Hold the power button until the TV fully restarts.
5. Note the TV's IP: **Settings → General → Network → Network Status → IP Settings**.

### 2. Tizen Studio on the PC

1. Install Tizen Studio 6.1 (the version Samsung's
   [TV SDK guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
   links to) with the IDE installer:
   [`web-ide_Tizen_Studio_6.1_windows-64.exe`](https://download.tizen.org/sdk/Installer/tizen-studio_6.1/web-ide_Tizen_Studio_6.1_windows-64.exe).
   The IDE includes the Certificate Manager used in step 3.
2. In **Package Manager**:
   - Under *Main SDK*, install **Tizen SDK tools**.
   - Under *Extension SDK*, install **TV Extensions** (if several versions are
     listed, take the newest) and **Samsung Certificate Extension** (2.0.73 or
     newer: older versions can no longer create certificates).
3. Add `C:\tizen-studio\tools` and `C:\tizen-studio\tools\ide\bin` to `PATH`
   for `sdb` and the `tizen` CLI.

### 3. Connect and create a certificate

```bash
sdb connect <TV-IP>
```

```bash
sdb devices
```

`sdb devices` lists the TV's device name. In Tizen Studio open
**Tools → Certificate Manager**, then **+** → **Samsung** → **TV**. Create a new
author certificate and sign in with a Samsung account. For the distributor
certificate, keep the default **Public** privilege level (the app needs nothing
more) and make sure the TV's DUID is in the list (it appears automatically while the TV is connected). Name the
profile `glordu`. Samsung certificates only install on TVs whose DUID is
listed.

### 4. Build, install, run

With the TV connected (`sdb connect <tv-ip>`), from the repo root:

```bash
npm run deploy
```

`scripts/deploy-tv.mjs` builds, signs with the `glordu` profile, installs and
launches the app. It picks the connected TV automatically; pass a device name
(`npm run deploy -- UE55AU7172UXXH`) if several are connected. It also renames
the package to `GlorduTV.wgt`: the TV's installer fails without an error
message on the default name, `Glordu TV.wgt`, because of the space.

Override `TIZEN_STUDIO` (default `C:\tizen-studio`) or `TIZEN_PROFILE`
(default `glordu`) if yours differ.

The app then appears in the TV's Apps list. You can pin it to the home bar.

### On the TV

- The app keeps the TV's screensaver away while the slideshow runs.
  **Settings → General → Eco Solution → Auto Power Off** stays on by choice,
  so the TV still switches itself off after a few hours without remote input
  rather than running all day.
- Sideloaded apps can disappear after a TV firmware update. Reinstall with
  step 4.
- What the app keeps on the TV (favorites, Settings, the slideshow's place,
  the log) survives reinstalling with `npm run deploy`. Uninstalling the
  app, or losing it to a firmware update, would lose it: there's no other
  copy.
