const { randomUUID } = require('node:crypto');
const {
  MAX_CHARACTERS_PER_ACCOUNT,
  MAX_CHAT_MESSAGES,
  MAX_NAME_LENGTH,
  MOVE_VECTORS,
  VISIBILITY_RADIUS,
} = require('./config');

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

function createZoneRuntime(zone) {
  return {
    chatLog: [
      {
        id: randomUUID(),
        author: 'System',
        message: `Welcome to ${zone.name}. Open a second browser tab with another username to test player visibility.`,
        type: 'system',
      },
    ],
    npcs: zone.npcIds.slice(),
  };
}

class World {
  constructor(content) {
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
    };
    this.npcsById = new Map(content.npcs.map((npc) => [npc.id, npc]));
  }

  getBootstrap() {
    return {
      target: {
        platform: 'browser',
        camera: 'top-down 2D',
        combatModel: 'real-time movement with NPC interaction for the first slice',
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
      hp: archetype.baseStats.hp,
      maxHp: archetype.baseStats.hp,
      stats: clone(archetype.baseStats),
      abilities: archetype.abilities.slice(),
      inventory: archetype.startingInventory.slice(),
      active: false,
    };

    this.characters.set(character.id, character);
    account.characterIds.push(character.id);
    this.metrics.charactersCreated += 1;

    return {
      character: this.serializeCharacterSummary(character),
      characters: account.characterIds.map((characterId) => this.serializeCharacterSummary(this.characters.get(characterId))),
    };
  }

  selectCharacter(token, characterId) {
    const character = this.getOwnedCharacter(token, characterId);
    character.active = true;

    return {
      character: this.serializeCharacterSummary(character),
      snapshot: this.getSnapshot(token, characterId),
    };
  }

  moveCharacter(token, characterId, direction) {
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
        snapshot: this.getSnapshot(token, characterId),
      };
    }

    character.x = nextPosition.x;
    character.y = nextPosition.y;
    character.facing = direction;
    character.animation = 'walk';
    character.state = 'moving';
    this.metrics.commandsProcessed += 1;

    return {
      ok: true,
      snapshot: this.getSnapshot(token, characterId),
    };
  }

  interact(token, characterId) {
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
      snapshot: this.getSnapshot(token, characterId),
    };
  }

  sendChat(token, characterId, message) {
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
      snapshot: this.getSnapshot(token, characterId),
    };
  }

  teleport(token, characterId, landmarkId = 'townSquare') {
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
      snapshot: this.getSnapshot(token, characterId),
    };
  }

  getSnapshot(token, characterId) {
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
        hp: character.hp,
        maxHp: character.maxHp,
        inventory: character.inventory.slice(),
        abilities: character.abilities.slice(),
        stats: clone(character.stats),
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
      },
      chatLog: zoneRuntime.chatLog,
      metrics: {
        activeSessions: this.metrics.activeSessions,
        activeCharactersInZone: players.length,
      },
    };
  }

  getMetrics() {
    return {
      ...this.metrics,
      characters: this.characters.size,
      zones: this.content.zones.length,
    };
  }

  serializeCharacterSummary(character) {
    return {
      id: character.id,
      name: character.name,
      archetypeId: character.archetypeId,
      level: character.level,
      zoneId: character.zoneId,
      active: character.active,
    };
  }

  findNearbyNpc(character) {
    return this.content.npcs.find(
      (npc) => npc.zoneId === character.zoneId && distance(npc, character) <= 1,
    );
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
