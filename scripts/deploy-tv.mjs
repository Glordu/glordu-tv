// Builds, signs, installs and launches the app on the TV in one go.
//
//   node scripts/deploy-tv.mjs [device]      (npm run deploy)
//
// Needs Tizen Studio (TIZEN_STUDIO, default C:\tizen-studio), an active
// certificate profile (TIZEN_PROFILE, default "glordu") and the TV connected
// with `sdb connect <tv-ip>`. With no device given, uses the only one connected.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app-tizen');
const OUT = path.join(APP, '.buildResult');
const STUDIO = process.env.TIZEN_STUDIO || 'C:\\tizen-studio';
const PROFILE = process.env.TIZEN_PROFILE || 'glordu';
const isWindows = process.platform === 'win32';
const TIZEN = path.join(STUDIO, 'tools', 'ide', 'bin', isWindows ? 'tizen.bat' : 'tizen');
const SDB = path.join(STUDIO, 'tools', isWindows ? 'sdb.exe' : 'sdb');
// The TV's installer fails silently on a package name with spaces, and the
// default name comes from <name> in config.xml ("Glordu TV").
const PACKAGE = 'GlorduTV.wgt';

function appId() {
  const xml = fs.readFileSync(path.join(APP, 'config.xml'), 'utf8');
  const match = /<tizen:application[^>]*\bid="([^"]+)"/.exec(xml);
  if (!match) throw new Error('No tizen:application id in config.xml');
  return match[1];
}

function run(cmd, args, { capture = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: isWindows && cmd.endsWith('.bat'),
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stdout + result.stderr);
    throw new Error(`${path.basename(cmd)} ${args[0]} failed`);
  }
  return result.stdout || '';
}

function pickDevice() {
  if (process.argv[2]) return process.argv[2];
  const lines = run(SDB, ['devices'], { capture: true })
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols[1] === 'device');
  if (lines.length !== 1) {
    throw new Error(`Expected one connected TV, found ${lines.length}. Run "sdb connect <tv-ip>" or pass the device name.`);
  }
  return lines[0][2]; // device name, e.g. UE55AU7172UXXH
}

const device = pickDevice();
const id = appId();
console.log(`Deploying ${id} to ${device}`);

run(TIZEN, ['build-web', '--', APP]);
run(TIZEN, ['package', '-t', 'wgt', '-s', PROFILE, '--', OUT]);
const built = fs.readdirSync(OUT).filter((f) => f.endsWith('.wgt'));
if (built.length !== 1) throw new Error(`Expected one .wgt in ${OUT}, found ${built.length}`);
if (built[0] !== PACKAGE) fs.renameSync(path.join(OUT, built[0]), path.join(OUT, PACKAGE));
run(TIZEN, ['install', '-n', PACKAGE, '-t', device, '--', OUT]);
run(TIZEN, ['run', '-p', id, '-t', device]);
console.log('Done. The app is running on the TV.');
