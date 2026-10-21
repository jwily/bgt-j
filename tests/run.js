// Runs every test pass on WebKit (Safari's engine) and Chromium against the app in ../app.
// Starts its own web server for the app, so nothing else needs to be running.
//
//   npm test                      all passes, both engines
//   npm test -- webkit            one engine
//   npm test -- webkit layout     one engine, one pass
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', 'app');
const PORT = 8765; // the passes expect the app here
const PASSES = ['main', 'more', 'layout'];
const ENGINES = ['webkit', 'chromium'];
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(APP, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath);
  if (!file.startsWith(APP)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(data);
  });
});

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
  await new Promise((resolve) => server.listen(PORT, resolve));
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
