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

### Modules

A module is one file in `app-tizen/modules/` that calls `GTV.register(...)`.
Add its `<script>` tag to `index.html`. See `js/core.js` for the interface.
Its settings come from `modules.<id>` in `config.json`.

| Module    | What it does |
|-----------|--------------|
| `ambient` | Photo slideshow with weather and clock in the bottom-right corner. Right/Left: next/previous photo. OK or Play/Pause: pause. Up/Down/Info: hide the clock and weather. |
| `home`    | Launcher tiles. Back from here exits. |
| `settings` | Location, time zone, temperature units and clock format, saved on the TV. |
| `about`   | Version, location and time zone in use, and whether each data file came live or from the offline copy. |

Back from the slideshow opens Home. Back from Home exits.

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

While a text field has focus, only OK, Back and ▲▼ reach the app; other keys
type into the field. The keyboard's Done and Cancel keys (65376, 65385) are
mapped in `platform/tizen.js`.

### Weather

`js/weather.js` is shared by any module that wants weather. It returns current
conditions plus a 7-day forecast, ready for a future forecast page, for the
location from Settings. Data comes from [Open-Meteo](https://open-meteo.com/),
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
minute later.

## Photos

`docs/v1/images.json` lists photos from the
[Chromecast backgrounds archive](https://github.com/dconnolly/chromecast-backgrounds).
It links to Google's servers rather than hosting the photos, which belong to
their photographers. Each entry keeps the photographer's name (`author`, null
for 50 of them) for possible later use; the app doesn't display it. The archive is from 2019 and its links are dying: in
November 2026, 403 of the 702 still worked.

```bash
npm run images   # re-check upstream URLs and rewrite docs/v1/images.json
                 # (Google rate-limits after many requests; those are kept, not dropped)
npm run backup   # download every listed photo to ./backup (gitignored, ~143 MB)
```

The backup is safe to re-run; it skips files it already has. `backup/index.json`
maps each file to its original URL and photographer. If the links go dark,
serve the backup from your home network or bundle it into the app, and point
`modules.ambient.images` at the new list.

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
2. On the TV open **Apps**, then type `1 2 3 4 5` with the remote's on-screen number pad.
3. Switch **Developer mode** to On, enter the PC's IP, and confirm.
4. Hold the power button until the TV fully restarts.
5. Note the TV's IP: **Settings → General → Network → Network Status → IP Settings**.

### 2. Tizen Studio on the PC

1. Install [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)
   (the "with IDE" installer is easiest).
2. In **Package Manager**:
   - Under *Main SDK*, install **Tizen SDK tools**.
   - Under *Extension SDK*, install **TV Extensions-6.0** (2021 models run Tizen 6.0)
     and **Samsung Certificate Extension**.
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

From the repo root:

```bash
tizen build-web -- app-tizen
```

```bash
tizen package -t wgt -s glordu -- app-tizen/.buildResult
```

```bash
tizen install -n "Glordu TV.wgt" -t <device-name> -- app-tizen/.buildResult
```

```bash
tizen run -p glordutv01.GlorduTV -t <device-name>
```

Alternatively, in Tizen Studio: **File → Import → Tizen → Tizen Project**,
pick `app-tizen/`, then right-click the project → **Run As → Tizen Web Application**.

The app then appears in the TV's Apps list. You can pin it to the home bar.

### On the TV

- Turn off **Settings → General → Eco Solution → Auto Power Off**, or the TV
  switches off after a few hours without remote input. The app already keeps
  the TV's screensaver away while the slideshow runs.
- Sideloaded apps can disappear after a TV firmware update. Reinstall with
  step 4.
