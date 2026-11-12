// Profiles the app on the TV: presses remote keys through the DevTools
// protocol and reports, per key, how long the TV spent rasterizing (turning
// the page into pixels) and the longest main-thread task. This is how we
// found that CSS gradients cost ~5 s of raster work per page slide.
//
// 1. Relaunch the app on the TV in debug mode and forward its port:
//      sdb shell 0 was_kill glordutv01.GlorduTV
//      sdb shell 0 debug glordutv01.GlorduTV        (prints "port: NNNNN")
//      sdb forward tcp:9222 tcp:NNNNN
// 2. Run, with steps in order:
//      node scripts/tv-trace.mjs down down up up right left
//    steps: down, up, left, right (keys), wait (3 s), css:<file> (inject a
//    stylesheet to try a change live), nocss (remove it).
//    MAIN=1 lists what runs inside the longest main-thread task instead.
import fs from 'node:fs';

const steps = process.argv.slice(2);
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
let traceDone = null;
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === 'Tracing.dataCollected') events.push(...msg.params.value);
  if (msg.method === 'Tracing.tracingComplete' && traceDone) traceDone();
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = { down: 40, up: 38, left: 37, right: 39 };

async function key(name) {
  const code = KEYS[name];
  const k = 'Arrow' + name[0].toUpperCase() + name.slice(1);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: k });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: k });
}

function threadNames() {
  const threads = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads[e.pid + ':' + e.tid] = e.args.name;
  return threads;
}

function summariseMain(label) {
  const threads = threadNames();
  const main = events.filter((e) => e.ph === 'X' && e.dur && /Renderer/.test(threads[e.pid + ':' + e.tid] || ''));
  const longest = main.filter((e) => /ThreadController/.test(e.name)).sort((a, b) => b.dur - a.dur)[0];
  if (!longest) return;
  const inside = main.filter(
    (e) => e.tid === longest.tid && e.ts >= longest.ts && e.ts + e.dur <= longest.ts + longest.dur && !/ThreadController|RunTask|TaskQueue/.test(e.name)
  );
  const by = {};
  for (const e of inside) {
    by[e.name] = by[e.name] || { total: 0, n: 0 };
    by[e.name].total += e.dur / 1000;
    by[e.name].n++;
  }
  console.log('');
  console.log('== ' + label + ': inside the ' + Math.round(longest.dur / 1000) + ' ms main-thread task');
  Object.entries(by)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 16)
    .forEach(([k, v]) => console.log(String(Math.round(v.total)).padStart(6) + ' ms  x' + String(v.n).padEnd(4) + k));
}

function summarise(label) {
  if (process.env.MAIN) return summariseMain(label);
  const threads = threadNames();
  let raster = 0;
  let mainMax = 0;
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const t = threads[e.pid + ':' + e.tid] || '';
    if (/TileWorker/.test(t) && e.name === 'RasterizerTaskImpl::RunOnWorkerThread') raster += e.dur / 1000;
    if (/Renderer/.test(t) && /ThreadController::Task/.test(e.name)) mainMax = Math.max(mainMax, e.dur / 1000);
  }
  console.log(label.padEnd(28) + ' raster ' + String(Math.round(raster)).padStart(5) + ' ms   longest main-thread task ' + String(Math.round(mainMax)).padStart(5) + ' ms');
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result && r.result.result.value;
}

ws.onopen = async () => {
  await send('Runtime.enable');
  console.log('current page:', await evaluate("document.querySelector('.page:not(.is-hidden)').className"));
  let tag = '';
  for (const step of steps) {
    if (step === 'wait') {
      await sleep(3000);
      continue;
    }
    if (step.startsWith('css:')) {
      const css = fs.readFileSync(step.slice(4), 'utf8');
      tag = ' [' + step.slice(4).split(/[\\/]/).pop() + ']';
      await evaluate('(function(){var s=document.getElementById("probe-css")||document.head.appendChild(Object.assign(document.createElement("style"),{id:"probe-css"}));s.textContent=' + JSON.stringify(css) + ';return true})()');
      await sleep(1500);
      continue;
    }
    if (step === 'nocss') {
      tag = '';
      await evaluate('(function(){var s=document.getElementById("probe-css");if(s)s.remove();return true})()');
      await sleep(1500);
      continue;
    }
    events.length = 0;
    await send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,blink,toplevel', transferMode: 'ReportEvents' });
    await sleep(300);
    await key(step);
    await sleep(2500);
    const done = new Promise((r) => (traceDone = r));
    await send('Tracing.end');
    await done;
    summarise(step + tag);
    await sleep(800);
  }
  ws.close();
};
