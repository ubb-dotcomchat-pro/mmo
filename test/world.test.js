const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent } = require('../src/content');
const { World } = require('../src/world');

function setupWorld() {
  return new World(loadContent());
}

test('login creates a reusable account and session', () => {
  const world = setupWorld();
  const first = world.login('ExplorerOne');
  const second = world.login('ExplorerOne');

  assert.equal(first.account.username, 'ExplorerOne');
  assert.equal(second.account.id, first.account.id);
  assert.notEqual(second.token, first.token);
});

test('characters can be created, selected, and moved within bounds', () => {
  const world = setupWorld();
  const login = world.login('Mover');
  const created = world.createCharacter(login.token, 'Kael', 'warden');

  assert.equal(created.character.name, 'Kael');
  const selection = world.selectCharacter(login.token, created.character.id);
  assert.equal(selection.snapshot.character.x, 2);
  assert.equal(selection.snapshot.character.y, 2);

  const move = world.moveCharacter(login.token, created.character.id, 'right');
  assert.equal(move.ok, true);
  assert.equal(move.snapshot.character.x, 3);
  assert.equal(move.snapshot.character.y, 2);
});

test('world snapshots only include nearby active players', () => {
  const world = setupWorld();
  const alpha = world.login('Alpha');
  const bravo = world.login('Bravo');
  const alphaCharacter = world.createCharacter(alpha.token, 'Astra', 'ranger').character;
  const bravoCharacter = world.createCharacter(bravo.token, 'Bram', 'mystic').character;

  world.selectCharacter(alpha.token, alphaCharacter.id);
  world.selectCharacter(bravo.token, bravoCharacter.id);
  world.teleport(bravo.token, bravoCharacter.id, 'forestGate');

  const snapshot = world.getSnapshot(alpha.token, alphaCharacter.id);
  assert.equal(snapshot.nearby.players.length, 1);
  assert.equal(snapshot.nearby.players[0].name, 'Astra');
});

test('interacting with a nearby npc returns dialog', () => {
  const world = setupWorld();
  const login = world.login('Speaker');
  const created = world.createCharacter(login.token, 'Mira', 'mystic').character;

  world.selectCharacter(login.token, created.id);
  world.moveCharacter(login.token, created.id, 'right');
  const interaction = world.interact(login.token, created.id);

  assert.equal(interaction.npc.name, 'Guide Lina');
  assert.match(interaction.npc.dialog, /WASD/);
});
