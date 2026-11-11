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
