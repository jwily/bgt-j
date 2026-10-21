// Runs every test pass on WebKit (Safari's engine) and Chromium against the app in ../app.
// Starts its own web server for the app, so nothing else needs to be running.
//
//   npm test                      all passes, both engines
//   npm test -- webkit            one engine
//   npm test -- webkit layout     one engine, one pass
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { serveApp } = require('./helpers');

const PASSES = ['main', 'more', 'layout'];
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

(async () => {
  const [onlyEngine, onlyPass] = process.argv.slice(2);
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  const server = await serveApp();
  let failed = false;
  for (const engine of ENGINES.filter((e) => !onlyEngine || e === onlyEngine)) {
    for (const pass of PASSES.filter((p) => !onlyPass || p === onlyPass)) {
      const { output, code } = await runPass(pass, engine);
      const passed = (output.match(/^PASS/gm) ?? []).length;
      const failures = output.split('\n').filter((line) => /^FAIL|CRASHED|^ERRORS/.test(line));
      const crashed = code !== 0 || /CRASHED/.test(output);
      if (failures.length || crashed) failed = true;
      console.log(`${failures.length || crashed ? '✗' : '✓'} ${engine.padEnd(8)} ${pass.padEnd(6)} ${passed} passed${failures.length ? `, ${failures.length} failed` : ''}`);
      failures.forEach((line) => console.log(`    ${line}`));
    }
  }
  server.close();
  console.log(failed ? '\nSome checks failed.' : '\nAll checks passed.');
  process.exitCode = failed ? 1 : 0;
})();
