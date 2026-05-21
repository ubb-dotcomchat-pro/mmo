const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { HOST, PORT } = require('./config');
const { loadContent } = require('./content');
const { World } = require('./world');

const content = loadContent();
const world = new World(content);
const publicDir = path.join(__dirname, '..', 'public');
const vendorFiles = new Map([
  ['/vendor/phaser.min.js', path.join(__dirname, '..', 'node_modules', 'phaser', 'dist', 'phaser.min.js')],
]);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('invalid json payload'));
      }
    });
    request.on('error', reject);
  });
}

function serveStatic(request, response) {
  const vendorFilePath = vendorFiles.get(request.url);

  if (vendorFilePath) {
    fs.readFile(vendorFilePath, (error, file) => {
      if (error) {
        sendJson(response, 404, { error: 'not found' });
        return;
      }

      const extension = path.extname(vendorFilePath);
      response.writeHead(200, { 'Content-Type': mimeTypes[extension] ?? 'application/octet-stream' });
      response.end(file);
    });
    return;
  }

  const requestPath = request.url === '/' ? '/index.html' : request.url;
  const safePath = path.normalize(requestPath).replace(/^\.+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 404, { error: 'not found' });
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      sendJson(response, 404, { error: 'not found' });
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extension] ?? 'application/octet-stream' });
    response.end(file);
  });
}

async function routeApi(request, response) {
  if (request.method === 'GET' && request.url === '/api/bootstrap') {
    sendJson(response, 200, world.getBootstrap());
    return;
  }

  if (request.method === 'GET' && request.url === '/api/admin/metrics') {
    sendJson(response, 200, world.getMetrics());
    return;
  }

  const body = await parseBody(request);

  if (request.method === 'POST' && request.url === '/api/login') {
    sendJson(response, 200, world.login(body.username));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/characters') {
    sendJson(response, 200, world.createCharacter(body.token, body.name, body.archetypeId));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/characters/select') {
    sendJson(response, 200, world.selectCharacter(body.token, body.characterId));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/world/snapshot') {
    sendJson(response, 200, world.getSnapshot(body.token, body.characterId));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/world/move') {
    sendJson(response, 200, world.moveCharacter(body.token, body.characterId, body.direction));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/world/interact') {
    sendJson(response, 200, world.interact(body.token, body.characterId));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/world/chat') {
    sendJson(response, 200, world.sendChat(body.token, body.characterId, body.message));
    return;
  }

  if (request.method === 'POST' && request.url === '/api/admin/teleport') {
    sendJson(response, 200, world.teleport(body.token, body.characterId, body.landmarkId));
    return;
  }

  sendJson(response, 404, { error: 'not found' });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url?.startsWith('/api/')) {
      await routeApi(request, response);
      return;
    }

    serveStatic(request, response);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    process.stdout.write(`MMO prototype listening on http://${HOST}:${PORT}\n`);
  });
}

module.exports = {
  server,
  world,
};
