// Runs every test pass on WebKit (Safari's engine) and Chromium against the app in ../app, all at once.
// Starts its own web server for the app, so nothing else needs to be running.
//
//   npm test                      all passes, both engines
//   npm test -- webkit            one engine
//   npm test -- webkit layout     one engine, one pass
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { serveApp } = require('./helpers');

const PASSES = ['main', 'more', 'layout', 'failures'];
const ENGINES = ['webkit', 'chromium'];

function runPass(pass, engine) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, `${pass}.js`)], { env: { ...process.env, ENGINE: engine } });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', (code) => resolve({ output, code }));
  });
}

// On a Mac, keep it from sleeping while the tests run (a sleeping Mac freezes the browsers, and the
// run sits silently until it wakes). caffeinate -w lets go as soon as this process ends.
if (process.platform === 'darwin') spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }).on('error', () => {}).unref();

(async () => {
  const [onlyEngine, onlyPass] = process.argv.slice(2);
  const engines = ENGINES.filter((e) => !onlyEngine || e === onlyEngine);
  for (const engine of engines) fs.mkdirSync(path.join(__dirname, 'output', engine), { recursive: true });
  const server = await serveApp();
  // All runs at once (each has its own browser and output folder; they share the app's server).
  // They spend most of their time waiting, not computing, so together they take about as long as
  // the slowest one. Results print in the usual order.
  const runs = engines.flatMap((engine) => PASSES.filter((p) => !onlyPass || p === onlyPass).map((pass) => ({ engine, pass })));
  const results = await Promise.all(runs.map(({ engine, pass }) => runPass(pass, engine)));
  let failed = false;
  for (const [i, { engine, pass }] of runs.entries()) {
    const { output, code } = results[i];
    const passed = (output.match(/^PASS/gm) ?? []).length;
    const failures = output.split('\n').filter((line) => /^FAIL|CRASHED|^ERRORS/.test(line));
    const crashed = code !== 0 || /CRASHED/.test(output);
    if (failures.length || crashed) failed = true;
    console.log(`${failures.length || crashed ? '✗' : '✓'} ${engine.padEnd(8)} ${pass.padEnd(6)} ${passed} passed${failures.length ? `, ${failures.length} failed` : ''}`);
    failures.forEach((line) => console.log(`    ${line}`));
  }
  server.close();
  console.log(failed ? '\nSome checks failed.' : '\nAll checks passed.');
  process.exitCode = failed ? 1 : 0;
})();
