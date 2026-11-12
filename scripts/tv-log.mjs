// Reads the app's problem log (js/log.js) from the TV over debug mode, for
// when Settings → Log can't be reached, e.g. the app fails to start. It only
// needs the page to load, not the app to work.
//
//   node scripts/tv-log.mjs           print the log, newest last
//   node scripts/tv-log.mjs --clear   print it, then empty it
//
// Needs the TV connected (`sdb connect <tv-ip>`). Uses the app already
// running in debug mode on local port 9222 (as scripts/tv-trace.mjs sets
// up); otherwise relaunches it in debug mode, which restarts it on the TV.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SDB, appIdIn, pickDevice } from './deploy-tv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_PORT = 9222;
// How long to wait for the app to start (after a relaunch, say) before
// reporting that it hasn't; loading the config alone may take up to 15 s.
const START_WAIT_MS = 20000;
const LEVELS = { error: 'ERROR', warn: 'WARN ', info: 'info ' };

// The debug port from `sdb shell 0 debug <app>`, which prints e.g.
// "... successfully launched pid = 2094 with debug 1 port: 41320".
export function debugPort(output) {
  const match = /port:\s*(\d+)/.exec(output);
  if (!match) throw new Error('No debug port in: ' + output.trim());
  return Number(match[1]);
}

const pad = (n) => String(n).padStart(2, '0');

function time(at) {
  const d = new Date(at);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// One line per entry, oldest first, as stored.
export function formatLog(entries) {
  if (!entries.length) return 'The log is empty.';
  return entries.map((e) => time(e.at) + '  ' + (LEVELS[e.level] || e.level) + '  ' + e.msg + (e.n > 1 ? '  (x' + e.n + ')' : '')).join('\n');
}

// What's on screen if the app hasn't started: "Loading…" or the error.
export function describeStart(state) {
  if (state.started) return 'The app is running.';
  return 'The app has not started. On screen: ' + (state.boot || '(nothing)');
}

function sdb(args) {
  const result = spawnSync(SDB, args, { encoding: 'utf8' });
  return (result.stdout || '') + (result.stderr || '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage() {
  try {
    const res = await fetch('http://127.0.0.1:' + LOCAL_PORT + '/json', { signal: AbortSignal.timeout(2000) });
    const targets = await res.json();
    return targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null;
  } catch (err) {
    return null;
  }
}

async function relaunchInDebugMode() {
  pickDevice(null, sdb(['devices'])); // throws unless exactly one TV is connected
  const id = appIdIn(fs.readFileSync(path.join(ROOT, 'app-tizen', 'config.xml'), 'utf8'));
  console.log('Relaunching ' + id + ' in debug mode on the TV…');
  sdb(['shell', '0', 'was_kill', id]);
  const port = debugPort(sdb(['shell', '0', 'debug', id]));
  sdb(['forward', 'tcp:' + LOCAL_PORT, 'tcp:' + port]);
  for (let i = 0; i < 20; i++) {
    const page = await findPage();
    if (page) return page;
    await sleep(500);
  }
  throw new Error('The app was launched, but its page never showed up for debugging.');
}

function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, (msg) => resolve(msg.result && msg.result.result && msg.result.result.value));
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ evaluate, close: () => ws.close() });
    ws.onerror = () => reject(new Error('Could not connect to the app on the TV.'));
  });
}

async function main() {
  const page = (await findPage()) || (await relaunchInDebugMode());
  const tv = await connect(page);
  // Straight from localStorage, so it works whatever state the app is in.
  const read = () =>
    tv.evaluate(
      "document.readyState === 'loading' ? null : { log: localStorage.getItem('gtv:log'), " +
        "started: !!document.querySelector('.pager'), boot: (document.querySelector('.boot') || {}).textContent || null }"
    );
  let state = await read();
  for (let waited = 0; waited < START_WAIT_MS && !(state && state.started); waited += 500) {
    await sleep(500);
    state = (await read()) || state;
  }
  if (!state) throw new Error('The page on the TV never finished loading.');
  console.log(formatLog(JSON.parse(state.log || '[]')));
  console.log('');
  console.log(describeStart(state));
  if (process.argv.includes('--clear')) {
    await tv.evaluate("localStorage.removeItem('gtv:log')");
    console.log('Cleared the log.');
  }
  tv.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
