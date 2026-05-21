const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent } = require('../src/content');
const { World } = require('../src/world');

function setupWorld(options) {
  return new World(loadContent(), options);
}

function sequenceRandom(values, fallback = 0) {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    return value ?? fallback;
  };
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

test('characters can equip items and trade with the vendor shop', () => {
  const world = setupWorld();
  const login = world.login('Trader');
  const created = world.createCharacter(login.token, 'Borin', 'warden').character;

  world.selectCharacter(login.token, created.id);
  world.moveCharacter(login.token, created.id, 'right');

  const interaction = world.interact(login.token, created.id);
  assert.equal(interaction.shop.name, 'Smith Oren');

  const equipped = world.equipItem(login.token, created.id, 'training-sword');
  assert.equal(equipped.snapshot.character.equipment.weapon.name, 'Training Sword');
  assert.equal(equipped.snapshot.character.stats.power, 5);

  const bought = world.buyItem(login.token, created.id, 'smith-oren', 'wooden-buckler');
  assert.equal(bought.snapshot.character.gold, 11);

  const shielded = world.equipItem(login.token, created.id, 'wooden-buckler');
  assert.equal(shielded.snapshot.character.equipment.shield.name, 'Wooden Buckler');
  assert.equal(shielded.snapshot.character.maxHp, 22);

  const sold = world.sellItem(login.token, created.id, 'smith-oren', 'iron-cuirass');
  assert.equal(sold.goldEarned, 7);
  assert.equal(sold.snapshot.character.gold, 18);
});

test('monsters can spawn automatically and drop loot after real-time combat', () => {
  const world = setupWorld({
    random: sequenceRandom([0, 0, 0.5, 0.5, 0, 0, 0]),
    now: () => 0,
  });

  world.advanceTime(0);
  world.advanceTime(2_000);
  assert.equal(world.zoneRuntime.get('starter-valley').monsters.length, 1);

  const login = world.login('Hunter');
  const created = world.createCharacter(login.token, 'Kael', 'warden').character;
  world.selectCharacter(login.token, created.id);
  world.equipItem(login.token, created.id, 'training-sword');

  const monster = world.spawnMonster('starter-valley', 'green-slime', { x: 3, y: 2 });
  world.targetMonster(login.token, created.id, monster.id);
  world.advanceTime(700);
  world.advanceTime(1_400);

  const snapshot = world.getSnapshot(login.token, created.id, { skipAdvance: true });
  assert.equal(snapshot.nearby.monsters.some((entry) => entry.id === monster.id), false);
  assert.equal(snapshot.character.gold, 28);
  assert.equal(snapshot.character.experience, 4);
  assert.equal(snapshot.character.inventory.some((item) => item.id === 'slime-gel'), true);
});
