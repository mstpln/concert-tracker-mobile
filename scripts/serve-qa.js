'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const resolveQaOutputPath = require('./qa-output-path');

const projectRoot = path.resolve('.');
const root = resolveQaOutputPath(projectRoot, process.env.QA_OUTPUT_DIR);
const staging = path.join(projectRoot, '.qa-build-staging');
const previous = path.join(projectRoot, '.qa-build-previous');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const watchMode = process.env.QA_WATCH === '1';
const liveClients = new Set();
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
const csp = "default-src 'self'; connect-src 'self' https://qa.invalid; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'";

function build(outputDir = root) {
  execFileSync(process.execPath, ['scripts/build-qa.js'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      QA_LIVE_RELOAD: watchMode ? '1' : '0',
      QA_OUTPUT_DIR: outputDir,
    },
  });
}

if (watchMode) build();

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    return response.writeHead(400).end('Bad request');
  }

  if (watchMode && pathname === '/__qa/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Content-Security-Policy': csp,
    });
    response.write(': connected\n\n');
    liveClients.add(response);
    request.on('close', () => liveClients.delete(response));
    return;
  }

  if (watchMode && pathname === '/qa-live-reload.js') {
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
    });
    return response.end("const qaEvents=new EventSource('/__qa/events');qaEvents.addEventListener('reload',()=>location.reload());");
  }

  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return response.writeHead(404, { 'Content-Security-Policy': csp }).end('Not found');
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
  });
  const stream = fs.createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
});

function shouldRebuild(file) {
  const relative = path.relative(projectRoot, file).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || relative.startsWith('dist/')
    || relative.startsWith('.qa-build-') || relative.startsWith('node_modules/')
    || relative.startsWith('.git/') || relative.startsWith('attached_assets/')) return false;
  if (relative === 'worker.js' || relative.startsWith('scripts/') && relative !== 'scripts/build-qa.js') return false;
  return relative === 'index.html' || relative === 'scripts/build-qa.js'
    || /^(?:[^/]+\.(?:js|css)|qa\/.*\.(?:js|css)|icons\/.*|assets\/listening\/.*)$/.test(relative);
}

if (watchMode) {
  let timer = null;
  let building = false;
  let rebuildAgain = false;
  const rebuild = () => {
    if (building) {
      rebuildAgain = true;
      return;
    }
    building = true;
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(previous, { recursive: true, force: true });
      build(staging);
      if (fs.existsSync(root)) fs.renameSync(root, previous);
      fs.renameSync(staging, root);
      fs.rmSync(previous, { recursive: true, force: true });
      for (const client of liveClients) client.write('event: reload\ndata: source changed\n\n');
    } catch (error) {
      console.error(`QA live rebuild failed: ${error.message}`);
      if (!fs.existsSync(root) && fs.existsSync(previous)) fs.renameSync(previous, root);
      fs.rmSync(staging, { recursive: true, force: true });
    } finally {
      building = false;
      if (rebuildAgain) {
        rebuildAgain = false;
        rebuild();
      }
    }
  };
  const schedule = (file) => {
    if (!shouldRebuild(file)) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 180);
  };

  const directories = [
    projectRoot,
    path.join(projectRoot, 'qa'),
    path.join(projectRoot, 'qa', 'fixtures'),
    path.join(projectRoot, 'icons'),
    path.join(projectRoot, 'assets'),
    path.join(projectRoot, 'assets', 'listening'),
  ].filter((directory) => fs.existsSync(directory));
  for (const directory of directories) {
    try {
      fs.watch(directory, (_event, filename) => {
        if (!filename) return schedule(directory);
        const changed = path.join(directory, filename.toString());
        if (fs.existsSync(changed) && fs.statSync(changed).isDirectory()) {
          try {
            fs.watch(changed, (_nestedEvent, nestedName) => {
              if (nestedName) schedule(path.join(changed, nestedName.toString()));
            });
          } catch {}
        }
        schedule(changed);
      });
    } catch (error) {
      console.warn(`QA watcher could not watch ${path.relative(projectRoot, directory)}: ${error.message}`);
    }
  }
}

server.listen(port, host, () => console.log(`QA preview at http://${host}:${port}${watchMode ? ' (watching frontend sources)' : ''}`));
