# glordu-tv

Personal Samsung TV app. See README.md for how it fits together.

## Git

Commit straight to `main`; this repo doesn't use feature branches or PRs.
Note that GitHub Pages serves `docs/` from `main`, so pushing a change there
publishes it to the TV.

## Code

The TV runs an old Chromium (Tizen 6.0): classic `<script>` tags, no ES
modules, no `?.` or `??`, no flexbox `gap`. Keep Tizen-only calls in
`app-tizen/platform/tizen.js`.

The TV rasterizes in software and is slow at it. No CSS gradients on large
areas (one full-screen gradient cost ~5 s of raster work per page slide);
use a small pre-drawn image from `scripts/make-backgrounds.mjs` instead.
Measure on the TV, not the PC: `scripts/tv-trace.mjs` (see its header) or
the Yellow-key readout.

## Tests

Run `npm test` before committing. Add or update tests in `test/` with every
change to app logic or the scripts (layout and looks stay manual). App files
are browser scripts: load them with `test/helpers/app.mjs`, which runs them
in a sandbox with a fake DOM and storage. Scripts export their logic and only
run `main()` from the command line, so tests can import them.
