const { randomUUID } = require('node:crypto');
const {
  MAX_CHARACTERS_PER_ACCOUNT,
  MAX_CHAT_MESSAGES,
  MAX_NAME_LENGTH,
  MOVE_VECTORS,
  VISIBILITY_RADIUS,
} = require('./config');

const EQUIPMENT_SLOTS = ['weapon', 'shield', 'armor', 'charm'];
const PLAYER_ATTACK_INTERVAL_MS = 700;
const MONSTER_ATTACK_INTERVAL_MS = 1100;
const MONSTER_MOVE_INTERVAL_MS = 900;
const MONSTER_AGGRO_RADIUS = 6;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAccountName(username) {
  return username.trim().toLowerCase();
}

function validateDisplayName(name, fieldName = 'name') {
  const value = `${name ?? ''}`.trim();
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
  if (value.length < 3 || value.length > MAX_NAME_LENGTH) {
    throw new Error(`${fieldName} must be 3-${MAX_NAME_LENGTH} characters long`);
  }
  if (!/^[a-z0-9 _-]+$/i.test(value)) {
    throw new Error(`${fieldName} can only include letters, numbers, spaces, underscores, and dashes`);
  }
  return value;
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function randomInt(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function createSystemMessage(message) {
  return {
    id: randomUUID(),
    author: 'System',
    message,
    type: 'system',
  };
}

function createZoneRuntime(zone) {
  return {
    chatLog: [
      createSystemMessage(
        `Welcome to ${zone.name}. Monsters now roam outside town, and Smith Oren can buy and sell equipment.`,
      ),
    ],
    npcs: zone.npcIds.slice(),
    monsters: [],
    nextSpawnAt: 0,
  };
}

function createEquipmentState() {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null]));
}

class World {
  constructor(content, options = {}) {
    this.content = content;
    this.accountsById = new Map();
    this.accountsByName = new Map();
    this.sessions = new Map();
    this.characters = new Map();
    this.zoneRuntime = new Map(content.zones.map((zone) => [zone.id, createZoneRuntime(zone)]));
    this.metrics = {
      commandsProcessed: 0,
      logins: 0,
      charactersCreated: 0,
      chatMessages: 0,
      interactions: 0,
      activeSessions: 0,
      monstersDefeated: 0,
      itemsPurchased: 0,
      itemsSold: 0,
      itemsEquipped: 0,
    };
    this.npcsById = new Map(content.npcs.map((npc) => [npc.id, npc]));
    this.random = options.random ?? Math.random;
    this.getNow = options.now ?? Date.now;
  }

  getBootstrap() {
    return {
      target: {
        platform: 'browser',
        camera: 'top-down 2D',
        combatModel: 'real-time movement, monster combat, equipment, and vendor interaction',
        multiplayerScale: 'single shard sized for ~50 concurrent players in the starter zone',
        controllableCharacters: 'single-avatar control per session',
      },
      firstPlayableSlice: {
        features: [
          'username login',
          'character creation and selection',
          'authoritative grid movement',
          'starter-valley zone',
          'nearby player visibility',
          'equipment slots and inventory management',
          'vendor shop buying and selling',
          'random monster spawns with item drops',
          'real-time monster combat',
          'npc dialog interaction',
          'zone chat',
        ],
      },
      archetypes: this.content.archetypes,
      zones: this.content.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        width: zone.width,
        height: zone.height,
        blockedTiles: zone.blockedTiles,
        landmarks: zone.landmarks,
      })),
    };
  }

  login(username) {
    const displayName = validateDisplayName(username, 'username');
    const normalized = normalizeAccountName(displayName);
    let account = this.accountsByName.get(normalized);

    if (!account) {
      account = {
        id: randomUUID(),
        username: displayName,
        characterIds: [],
        muted: false,
      };
      this.accountsById.set(account.id, account);
      this.accountsByName.set(normalized, account);
    }

    const token = randomUUID();
    this.sessions.set(token, account.id);
    this.metrics.logins += 1;
    this.metrics.activeSessions = this.sessions.size;

    return {
      token,
      account: {
        id: account.id,
        username: account.username,
      },
      characters: account.characterIds.map((characterId) => this.serializeCharacterSummary(this.characters.get(characterId))),
    };
  }

  createCharacter(token, name, archetypeId) {
    const account = this.getAccountByToken(token);
    const archetype = this.content.archetypesById[archetypeId];

    if (!archetype) {
      throw new Error('unknown archetype');
    }
    if (account.characterIds.length >= MAX_CHARACTERS_PER_ACCOUNT) {
      throw new Error(`maximum of ${MAX_CHARACTERS_PER_ACCOUNT} characters reached`);
    }

    const displayName = validateDisplayName(name, 'character name');
    const zone = this.content.zones[0];
    const spawnPoint = zone.spawn;
    const character = {
      id: randomUUID(),
      accountId: account.id,
      name: displayName,
      archetypeId,
      zoneId: zone.id,
      x: spawnPoint.x,
      y: spawnPoint.y,
      facing: 'down',
      animation: 'idle',
      state: 'idle',
      level: 1,
      experience: 0,
      baseStats: clone(archetype.baseStats),
      hp: archetype.baseStats.hp,
      maxHp: archetype.baseStats.hp,
      stats: clone(archetype.baseStats),
      abilities: archetype.abilities.slice(),
      inventory: archetype.startingInventory.slice(),
      equipment: createEquipmentState(),
      gold: 25,
      active: false,
      targetMonsterId: null,
      lastAttackAt: 0,
    };
    this.recalculateCharacterStats(character);

    this.characters.set(character.id, character);
    account.characterIds.push(character.id);
    this.metrics.charactersCreated += 1;

    return {
      character: this.serializeCharacterSummary(character),
      characters: account.characterIds.map((characterId) => this.serializeCharacterSummary(this.characters.get(characterId))),
    };
  }

  selectCharacter(token, characterId) {
    this.advanceTime();
    const character = this.getOwnedCharacter(token, characterId);
    character.active = true;

    return {
      character: this.serializeCharacterSummary(character),
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  moveCharacter(token, characterId, direction) {
    this.advanceTime();
    const vector = MOVE_VECTORS[direction];
    if (!vector) {
      throw new Error('unknown direction');
    }

    const character = this.getOwnedCharacter(token, characterId);
    const zone = this.content.zonesById[character.zoneId];
    const nextPosition = {
      x: character.x + vector.x,
      y: character.y + vector.y,
    };

    if (this.isBlocked(zone, nextPosition)) {
      character.animation = 'idle';
      character.state = 'blocked';
      return {
        ok: false,
        reason: 'blocked',
        snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
      };
    }

    character.x = nextPosition.x;
    character.y = nextPosition.y;
    character.facing = direction;
    character.animation = 'walk';
    character.state = character.targetMonsterId ? 'chasing' : 'moving';
    this.metrics.commandsProcessed += 1;

    return {
      ok: true,
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  interact(token, characterId) {
    this.advanceTime();
    const character = this.getOwnedCharacter(token, characterId);
    const nearbyNpc = this.findNearbyNpc(character);

    if (!nearbyNpc) {
      throw new Error('no npc nearby');
    }

    character.animation = 'idle';
    character.state = 'interacting';
    this.metrics.interactions += 1;

    return {
      npc: {
        id: nearbyNpc.id,
        name: nearbyNpc.name,
        dialog: nearbyNpc.dialog,
      },
      shop: nearbyNpc.role === 'vendor' ? this.serializeShop(nearbyNpc) : null,
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  equipItem(token, characterId, itemId) {
    this.advanceTime();
    const character = this.getOwnedCharacter(token, characterId);
    const item = this.requireItem(itemId);

    if (!EQUIPMENT_SLOTS.includes(item.slot)) {
      throw new Error('item cannot be equipped');
    }

    this.removeInventoryItem(character, itemId);
    if (character.equipment[item.slot]) {
      character.inventory.push(character.equipment[item.slot]);
    }
    character.equipment[item.slot] = itemId;
    this.recalculateCharacterStats(character);
    character.state = 'equipped';
    this.metrics.itemsEquipped += 1;

    return {
      item: this.serializeItem(itemId),
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  unequipItem(token, characterId, slot) {
    this.advanceTime();
    if (!EQUIPMENT_SLOTS.includes(slot)) {
      throw new Error('unknown equipment slot');
    }

    const character = this.getOwnedCharacter(token, characterId);
    const equippedItemId = character.equipment[slot];
    if (!equippedItemId) {
      throw new Error('nothing equipped in that slot');
    }

    character.inventory.push(equippedItemId);
    character.equipment[slot] = null;
    this.recalculateCharacterStats(character);
    character.state = 'equipped';

    return {
      slot,
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  buyItem(token, characterId, npcId, itemId) {
    this.advanceTime();
    const character = this.getOwnedCharacter(token, characterId);
    const vendor = this.getNearbyVendor(character, npcId);
    if (!vendor.shopInventory?.includes(itemId)) {
      throw new Error('item not sold here');
    }

    const item = this.requireItem(itemId);
    if (character.gold < item.value) {
      throw new Error('not enough gold');
    }

    character.gold -= item.value;
    character.inventory.push(itemId);
    character.state = 'shopping';
    this.metrics.itemsPurchased += 1;

    return {
      item: this.serializeItem(itemId),
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  sellItem(token, characterId, npcId, itemId) {
    this.advanceTime();
    const character = this.getOwnedCharacter(token, characterId);
    this.getNearbyVendor(character, npcId);
    const item = this.requireItem(itemId);
    this.removeInventoryItem(character, itemId);

    const saleValue = Math.max(1, Math.floor(item.value / 2));
    character.gold += saleValue;
    character.state = 'shopping';
    this.metrics.itemsSold += 1;

    return {
      goldEarned: saleValue,
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  targetMonster(token, characterId, monsterId) {
    this.advanceTime();
    const character = this.getOwnedCharacter(token, characterId);
    const monster = this.getMonsterById(character.zoneId, monsterId);

    if (!monster || distance(character, monster) > VISIBILITY_RADIUS) {
      throw new Error('monster not found');
    }

    character.targetMonsterId = monsterId;
    character.state = 'engaged';
    character.animation = 'attack';

    return {
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  clearCombatTarget(token, characterId) {
    this.advanceTime();
    const character = this.getOwnedCharacter(token, characterId);
    character.targetMonsterId = null;
    character.state = 'idle';
    character.animation = 'idle';

    return {
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  sendChat(token, characterId, message) {
    this.advanceTime();
    const account = this.getAccountByToken(token);
    if (account.muted) {
      throw new Error('account is muted');
    }

    const character = this.getOwnedCharacter(token, characterId);
    const trimmed = `${message ?? ''}`.trim();
    if (!trimmed) {
      throw new Error('message is required');
    }
    if (trimmed.length > 120) {
      throw new Error('message must be 120 characters or fewer');
    }

    const zoneRuntime = this.zoneRuntime.get(character.zoneId);
    zoneRuntime.chatLog.push({
      id: randomUUID(),
      author: character.name,
      message: trimmed,
      type: 'player',
    });
    zoneRuntime.chatLog = zoneRuntime.chatLog.slice(-MAX_CHAT_MESSAGES);
    this.metrics.chatMessages += 1;

    return {
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  teleport(token, characterId, landmarkId = 'townSquare') {
    this.advanceTime();
    const character = this.getOwnedCharacter(token, characterId);
    const zone = this.content.zonesById[character.zoneId];
    const landmark = zone.landmarks.find((entry) => entry.id === landmarkId);

    if (!landmark) {
      throw new Error('unknown landmark');
    }

    character.x = landmark.x;
    character.y = landmark.y;
    character.animation = 'idle';
    character.state = 'teleported';
    this.metrics.commandsProcessed += 1;

    return {
      snapshot: this.getSnapshot(token, characterId, { skipAdvance: true }),
    };
  }

  getSnapshot(token, characterId, options = {}) {
    if (!options.skipAdvance) {
      this.advanceTime();
    }

    const character = this.getOwnedCharacter(token, characterId);
    const zone = this.content.zonesById[character.zoneId];
    const zoneRuntime = this.zoneRuntime.get(zone.id);
    const players = [];

    for (const entry of this.characters.values()) {
      if (!entry.active || entry.zoneId !== character.zoneId) {
        continue;
      }
      if (distance(entry, character) > VISIBILITY_RADIUS) {
        continue;
      }
      players.push({
        id: entry.id,
        name: entry.name,
        x: entry.x,
        y: entry.y,
        animation: entry.animation,
        state: entry.state,
        archetypeId: entry.archetypeId,
        isSelf: entry.id === character.id,
      });
    }

    const npcs = this.content.npcs
      .filter((npc) => npc.zoneId === character.zoneId && distance(npc, character) <= VISIBILITY_RADIUS)
      .map((npc) => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
        x: npc.x,
        y: npc.y,
      }));

    const monsters = zoneRuntime.monsters
      .filter((monster) => distance(monster, character) <= VISIBILITY_RADIUS)
      .map((monster) => ({
        id: monster.id,
        templateId: monster.templateId,
        name: monster.name,
        x: monster.x,
        y: monster.y,
        hp: monster.hp,
        maxHp: monster.maxHp,
        state: monster.state,
      }));

    return {
      character: {
        id: character.id,
        name: character.name,
        archetypeId: character.archetypeId,
        x: character.x,
        y: character.y,
        facing: character.facing,
        animation: character.animation,
        state: character.state,
        level: character.level,
        experience: character.experience,
        hp: character.hp,
        maxHp: character.maxHp,
        gold: character.gold,
        inventory: this.serializeInventory(character.inventory),
        equipment: this.serializeEquipment(character.equipment),
        abilities: character.abilities.slice(),
        stats: clone(character.stats),
        targetMonsterId: character.targetMonsterId,
      },
      zone: {
        id: zone.id,
        name: zone.name,
        width: zone.width,
        height: zone.height,
        blockedTiles: zone.blockedTiles,
        landmarks: zone.landmarks,
      },
      nearby: {
        players,
        npcs,
        monsters,
      },
      chatLog: zoneRuntime.chatLog,
      metrics: {
        activeSessions: this.metrics.activeSessions,
        activeCharactersInZone: players.length,
        monstersInZone: zoneRuntime.monsters.length,
      },
    };
  }

  getMetrics() {
    return {
      ...this.metrics,
      characters: this.characters.size,
      zones: this.content.zones.length,
      monstersAlive: Array.from(this.zoneRuntime.values()).reduce((total, zoneRuntime) => total + zoneRuntime.monsters.length, 0),
    };
  }

  advanceTime(now = this.getNow()) {
    for (const zone of this.content.zones) {
      const zoneRuntime = this.zoneRuntime.get(zone.id);
      if (!zoneRuntime.nextSpawnAt) {
        zoneRuntime.nextSpawnAt = now + this.getNextSpawnDelay(zone);
      }
      if (zoneRuntime.monsters.length < (zone.monsterSpawn?.maxAlive ?? 0) && now >= zoneRuntime.nextSpawnAt) {
        this.spawnMonster(zone.id);
        zoneRuntime.nextSpawnAt = now + this.getNextSpawnDelay(zone);
      }
    }

    this.processPlayerCombat(now);
    this.processMonsters(now);
  }

  spawnMonster(zoneId, templateId, position) {
    const zone = this.content.zonesById[zoneId];
    const template = templateId ? this.content.monstersById[templateId] : this.chooseMonsterTemplate(zone);
    if (!zone || !template) {
      throw new Error('unable to spawn monster');
    }

    const spawnPosition = position ?? this.findSpawnPosition(zone);
    if (!spawnPosition) {
      return null;
    }

    const monster = {
      id: randomUUID(),
      templateId: template.id,
      zoneId,
      name: template.name,
      x: spawnPosition.x,
      y: spawnPosition.y,
      hp: template.hp,
      maxHp: template.hp,
      power: template.power,
      agility: template.agility,
      experience: template.experience,
      goldDrop: template.goldDrop,
      itemDrops: template.itemDrops,
      state: 'roaming',
      lastAttackAt: 0,
      lastMoveAt: 0,
    };

    this.zoneRuntime.get(zoneId).monsters.push(monster);
    return monster;
  }

  processPlayerCombat(now) {
    for (const character of this.characters.values()) {
      if (!character.active || !character.targetMonsterId) {
        continue;
      }

      const monster = this.getMonsterById(character.zoneId, character.targetMonsterId);
      if (!monster) {
        character.targetMonsterId = null;
        character.state = 'idle';
        character.animation = 'idle';
        continue;
      }

      if (distance(character, monster) > 1) {
        character.state = 'chasing';
        character.animation = 'idle';
        continue;
      }

      if (now - character.lastAttackAt < PLAYER_ATTACK_INTERVAL_MS) {
        continue;
      }

      character.lastAttackAt = now;
      character.state = 'attacking';
      character.animation = 'attack';
      monster.state = 'under-attack';
      monster.hp -= this.rollDamage(character.stats.power, character.stats.agility);
      if (monster.hp <= 0) {
        this.handleMonsterDefeat(character, monster);
      }
    }
  }

  processMonsters(now) {
    for (const zone of this.content.zones) {
      const zoneRuntime = this.zoneRuntime.get(zone.id);
      for (const monster of zoneRuntime.monsters) {
        const target = this.findNearestCharacter(monster);
        if (!target) {
          this.wanderMonster(zone, monster, now);
          continue;
        }

        const targetDistance = distance(monster, target);
        if (targetDistance <= 1) {
          if (now - monster.lastAttackAt >= MONSTER_ATTACK_INTERVAL_MS) {
            monster.lastAttackAt = now;
            monster.state = 'attacking';
            target.hp -= this.rollDamage(monster.power, monster.agility);
            target.state = 'under attack';
            target.animation = 'hurt';
            if (target.hp <= 0) {
              this.handleCharacterDefeat(target);
            }
          }
          continue;
        }

        if (targetDistance <= MONSTER_AGGRO_RADIUS) {
          if (now - monster.lastMoveAt >= MONSTER_MOVE_INTERVAL_MS) {
            const nextPosition = {
              x: monster.x + Math.sign(target.x - monster.x),
              y: monster.y + Math.sign(target.y - monster.y),
            };
            if (!this.isBlocked(zone, nextPosition)) {
              monster.x = nextPosition.x;
              monster.y = nextPosition.y;
            }
            monster.state = 'chasing';
            monster.lastMoveAt = now;
          }
          continue;
        }

        this.wanderMonster(zone, monster, now);
      }
    }
  }

  wanderMonster(zone, monster, now) {
    if (now - monster.lastMoveAt < MONSTER_MOVE_INTERVAL_MS) {
      return;
    }

    const directions = Object.values(MOVE_VECTORS);
    const vector = directions[randomInt(this.random, 0, directions.length - 1)];
    const nextPosition = {
      x: monster.x + vector.x,
      y: monster.y + vector.y,
    };
    if (!this.isBlocked(zone, nextPosition)) {
      monster.x = nextPosition.x;
      monster.y = nextPosition.y;
    }
    monster.state = 'roaming';
    monster.lastMoveAt = now;
  }

  handleMonsterDefeat(character, monster) {
    const zoneRuntime = this.zoneRuntime.get(monster.zoneId);
    zoneRuntime.monsters = zoneRuntime.monsters.filter((entry) => entry.id !== monster.id);
    character.targetMonsterId = null;
    character.state = 'victorious';
    character.animation = 'idle';
    character.experience += monster.experience;
    character.gold += monster.goldDrop;
    this.metrics.monstersDefeated += 1;

    const drops = [];
    for (const drop of monster.itemDrops) {
      if (this.random() <= drop.chance) {
        character.inventory.push(drop.itemId);
        drops.push(this.requireItem(drop.itemId).name);
      }
    }

    const rewardText = `${character.name} defeated ${monster.name} for ${monster.goldDrop} gold and ${monster.experience} XP`;
    this.pushZoneMessage(monster.zoneId, drops.length > 0 ? `${rewardText}. Found ${drops.join(', ')}.` : `${rewardText}.`);

    const levelThreshold = character.level * 10;
    if (character.experience >= levelThreshold) {
      character.level += 1;
      character.baseStats.hp += 2;
      character.baseStats.power += 1;
      character.baseStats.agility += 1;
      character.hp = character.maxHp;
      this.recalculateCharacterStats(character);
      this.pushZoneMessage(monster.zoneId, `${character.name} reached level ${character.level}.`);
    }
  }

  handleCharacterDefeat(character) {
    const zone = this.content.zonesById[character.zoneId];
    character.hp = character.maxHp;
    character.x = zone.spawn.x;
    character.y = zone.spawn.y;
    character.targetMonsterId = null;
    character.state = 'respawned';
    character.animation = 'idle';
    this.pushZoneMessage(character.zoneId, `${character.name} was knocked out and respawned in town.`);
  }

  serializeCharacterSummary(character) {
    return {
      id: character.id,
      name: character.name,
      archetypeId: character.archetypeId,
      level: character.level,
      zoneId: character.zoneId,
      active: character.active,
      gold: character.gold,
    };
  }

  serializeInventory(inventory) {
    const counts = new Map();
    for (const itemId of inventory) {
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([itemId, quantity]) => ({
      ...this.serializeItem(itemId),
      quantity,
    }));
  }

  serializeEquipment(equipment) {
    return Object.fromEntries(
      EQUIPMENT_SLOTS.map((slot) => [slot, equipment[slot] ? this.serializeItem(equipment[slot]) : null]),
    );
  }

  serializeItem(itemId) {
    const item = this.requireItem(itemId);
    return {
      id: item.id,
      name: item.name,
      slot: item.slot,
      value: item.value,
      statBonuses: clone(item.statBonuses),
    };
  }

  serializeShop(npc) {
    return {
      npcId: npc.id,
      name: npc.name,
      stock: (npc.shopInventory ?? []).map((itemId) => this.serializeItem(itemId)),
    };
  }

  recalculateCharacterStats(character) {
    const stats = clone(character.baseStats);
    for (const slot of EQUIPMENT_SLOTS) {
      const itemId = character.equipment[slot];
      if (!itemId) {
        continue;
      }
      const item = this.requireItem(itemId);
      for (const [statName, bonus] of Object.entries(item.statBonuses)) {
        stats[statName] = (stats[statName] ?? 0) + bonus;
      }
    }

    character.stats = stats;
    character.maxHp = stats.hp;
    character.hp = Math.min(character.hp, character.maxHp);
  }

  requireItem(itemId) {
    const item = this.content.itemsById[itemId];
    if (!item) {
      throw new Error('unknown item');
    }
    return item;
  }

  removeInventoryItem(character, itemId) {
    const index = character.inventory.indexOf(itemId);
    if (index === -1) {
      throw new Error('item not found in inventory');
    }
    character.inventory.splice(index, 1);
  }

  pushZoneMessage(zoneId, message) {
    const zoneRuntime = this.zoneRuntime.get(zoneId);
    zoneRuntime.chatLog.push(createSystemMessage(message));
    zoneRuntime.chatLog = zoneRuntime.chatLog.slice(-MAX_CHAT_MESSAGES);
  }

  chooseMonsterTemplate(zone) {
    const candidates = (zone.monsterIds ?? []).map((monsterId) => this.content.monstersById[monsterId]).filter(Boolean);
    if (candidates.length === 0) {
      return null;
    }

    const totalWeight = candidates.reduce((sum, monster) => sum + (monster.spawnWeight ?? 1), 0);
    let roll = this.random() * totalWeight;
    for (const monster of candidates) {
      roll -= monster.spawnWeight ?? 1;
      if (roll <= 0) {
        return monster;
      }
    }
    return candidates[candidates.length - 1];
  }

  getNextSpawnDelay(zone) {
    return randomInt(this.random, zone.monsterSpawn?.minIntervalMs ?? 1_000, zone.monsterSpawn?.maxIntervalMs ?? 2_000);
  }

  findSpawnPosition(zone) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const point = {
        x: randomInt(this.random, 0, zone.width - 1),
        y: randomInt(this.random, 0, zone.height - 1),
      };
      if (this.isBlocked(zone, point) || distance(point, zone.spawn) < 4) {
        continue;
      }
      return point;
    }
    return null;
  }

  findNearestCharacter(monster) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const character of this.characters.values()) {
      if (!character.active || character.zoneId !== monster.zoneId) {
        continue;
      }
      const currentDistance = distance(character, monster);
      if (currentDistance < bestDistance) {
        best = character;
        bestDistance = currentDistance;
      }
    }

    return bestDistance <= MONSTER_AGGRO_RADIUS ? best : null;
  }

  findNearbyNpc(character, npcId) {
    return this.content.npcs.find(
      (npc) => npc.zoneId === character.zoneId && (!npcId || npc.id === npcId) && distance(npc, character) <= 1,
    );
  }

  getNearbyVendor(character, npcId) {
    const vendor = this.findNearbyNpc(character, npcId);
    if (!vendor || vendor.role !== 'vendor') {
      throw new Error('no vendor nearby');
    }
    return vendor;
  }

  getMonsterById(zoneId, monsterId) {
    return this.zoneRuntime.get(zoneId)?.monsters.find((monster) => monster.id === monsterId) ?? null;
  }

  rollDamage(power, agility) {
    return Math.max(1, power + randomInt(this.random, 0, Math.max(1, Math.ceil(agility / 2))) - 1);
  }

  isBlocked(zone, position) {
    if (position.x < 0 || position.y < 0 || position.x >= zone.width || position.y >= zone.height) {
      return true;
    }

    return zone.blockedTiles.some((tile) => tile.x === position.x && tile.y === position.y);
  }

  getAccountByToken(token) {
    const accountId = this.sessions.get(token);
    if (!accountId) {
      throw new Error('invalid session');
    }

    return this.accountsById.get(accountId);
  }

  getOwnedCharacter(token, characterId) {
    const account = this.getAccountByToken(token);
    const character = this.characters.get(characterId);

    if (!character || character.accountId !== account.id) {
      throw new Error('character not found');
    }

    return character;
  }
}

module.exports = {
  World,
};
