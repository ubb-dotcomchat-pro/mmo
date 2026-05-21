const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { server } = require('../src/server');

test('server exposes the Phaser browser bundle', async (t) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  );

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/vendor/phaser.min.js`);
  const script = await response.text();

  assert.equal(response.status, 200);
  assert.match(script, /Phaser/);
});
