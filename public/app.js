const VIEWPORT_SIZE = 640;
const MOVE_KEYS = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

const state = {
  bootstrap: null,
  token: '',
  account: null,
  characters: [],
  selectedCharacterId: '',
  snapshot: null,
  message: 'Login and select a character to start.',
  pollHandle: null,
  moveCooldown: false,
  interaction: null,
  phaserGame: null,
  worldRenderer: null,
};

const elements = {
  loginForm: document.querySelector('#login-form'),
  username: document.querySelector('#username'),
  characterPanel: document.querySelector('#character-panel'),
  characterList: document.querySelector('#character-list'),
  createCharacterForm: document.querySelector('#create-character-form'),
  characterName: document.querySelector('#character-name'),
  archetypeSelect: document.querySelector('#archetype-select'),
  gamePanel: document.querySelector('#game-panel'),
  gameRoot: document.querySelector('#game-root'),
  zoneName: document.querySelector('#zone-name'),
  statusLine: document.querySelector('#status-line'),
  characterStats: document.querySelector('#character-stats'),
  inspectBox: document.querySelector('#inspect-box'),
  chatLog: document.querySelector('#chat-log'),
  chatForm: document.querySelector('#chat-form'),
  chatInput: document.querySelector('#chat-input'),
  interactButton: document.querySelector('#interact-button'),
  teleportButton: document.querySelector('#teleport-button'),
  inspectButton: document.querySelector('#inspect-button'),
};

async function request(url, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function setMessage(message) {
  state.message = message;
  elements.statusLine.textContent = message;
}

function renderCharacterList() {
  elements.characterList.innerHTML = '';
  for (const character of state.characters) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const details = document.createElement('span');
    const level = document.createElement('span');

    button.type = 'button';
    button.className = 'character-card';
    details.textContent = `${character.name} · ${character.archetypeId}`;
    level.textContent = `Lvl ${character.level}`;
    button.append(details, level);
    button.addEventListener('click', () => selectCharacter(character.id));
    item.appendChild(button);
    elements.characterList.appendChild(item);
  }
}

function renderArchetypes() {
  elements.archetypeSelect.innerHTML = '';
  for (const archetype of state.bootstrap.archetypes) {
    const option = document.createElement('option');
    option.value = archetype.id;
    option.textContent = `${archetype.name} — ${archetype.summary}`;
    elements.archetypeSelect.appendChild(option);
  }
}

function renderChatLog() {
  const chatEntries = state.snapshot?.chatLog ?? [];
  elements.chatLog.innerHTML = '';
  for (const entry of chatEntries) {
    const line = document.createElement('p');
    const author = document.createElement('strong');

    line.className = 'chat-entry';
    author.textContent = `${entry.author}:`;
    line.append(author, ` ${entry.message}`);
    elements.chatLog.appendChild(line);
  }
}

function renderStats() {
  const character = state.snapshot?.character;
  if (!character) {
    elements.characterStats.textContent = 'No character selected yet.';
    return;
  }

  elements.characterStats.textContent = JSON.stringify(
    {
      name: character.name,
      archetype: character.archetypeId,
      level: character.level,
      hp: `${character.hp}/${character.maxHp}`,
      state: character.state,
      abilities: character.abilities,
      inventory: character.inventory,
      stats: character.stats,
    },
    null,
    2,
  );
}

function createWorldRenderer(scene) {
  const backgroundLayer = scene.add.graphics();
  const gridLayer = scene.add.graphics();
  const blockedLayer = scene.add.graphics();
  const entityLayer = scene.add.graphics();
  const highlightLayer = scene.add.graphics();
  const labels = [];

  function clearLabels() {
    while (labels.length > 0) {
      labels.pop().destroy();
    }
  }

  function drawLabel(text, x, y, fontSize = '12px') {
    const label = scene.add.text(x, y, text, {
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize,
    });
    labels.push(label);
  }

  function toPixels(originX, originY, tileSize, point) {
    return {
      x: originX + point.x * tileSize,
      y: originY + point.y * tileSize,
    };
  }

  return {
    render(snapshot) {
      clearLabels();
      backgroundLayer.clear();
      gridLayer.clear();
      blockedLayer.clear();
      entityLayer.clear();
      highlightLayer.clear();

      backgroundLayer.fillStyle(0x1f2937, 1);
      backgroundLayer.fillRect(0, 0, VIEWPORT_SIZE, VIEWPORT_SIZE);

      if (!snapshot) {
        backgroundLayer.fillStyle(0x0b1120, 1);
        backgroundLayer.fillRect(32, 32, VIEWPORT_SIZE - 64, VIEWPORT_SIZE - 64);
        return;
      }

      const { zone, nearby, character } = snapshot;
      const tileSize = Math.max(16, Math.floor(Math.min(VIEWPORT_SIZE / zone.width, VIEWPORT_SIZE / zone.height)));
      const mapWidth = zone.width * tileSize;
      const mapHeight = zone.height * tileSize;
      const originX = Math.floor((VIEWPORT_SIZE - mapWidth) / 2);
      const originY = Math.floor((VIEWPORT_SIZE - mapHeight) / 2);

      backgroundLayer.fillStyle(0x0b1120, 1);
      backgroundLayer.fillRect(originX, originY, mapWidth, mapHeight);

      gridLayer.lineStyle(1, 0x334155, 1);
      for (let y = 0; y < zone.height; y += 1) {
        for (let x = 0; x < zone.width; x += 1) {
          gridLayer.strokeRect(originX + x * tileSize, originY + y * tileSize, tileSize, tileSize);
        }
      }

      blockedLayer.fillStyle(0x14532d, 1);
      for (const tile of zone.blockedTiles) {
        const position = toPixels(originX, originY, tileSize, tile);
        blockedLayer.fillRect(position.x, position.y, tileSize, tileSize);
      }

      for (const landmark of zone.landmarks) {
        const position = toPixels(originX, originY, tileSize, landmark);
        entityLayer.fillStyle(0x78350f, 1);
        entityLayer.fillRect(position.x, position.y, tileSize, tileSize);
        drawLabel(landmark.label, position.x + 2, position.y + tileSize - 16, '10px');
      }

      for (const npc of nearby.npcs) {
        const position = toPixels(originX, originY, tileSize, npc);
        entityLayer.fillStyle(0xfacc15, 1);
        entityLayer.fillCircle(position.x + tileSize / 2, position.y + tileSize / 2, tileSize / 3);
        drawLabel(npc.name, position.x, position.y - 16);
      }

      for (const player of nearby.players) {
        const position = toPixels(originX, originY, tileSize, player);
        entityLayer.fillStyle(player.isSelf ? 0x22c55e : 0x60a5fa, 1);
        entityLayer.fillCircle(position.x + tileSize / 2, position.y + tileSize / 2, tileSize / 3);
        drawLabel(player.name, position.x, position.y - 16);
      }

      const highlightPosition = toPixels(originX, originY, tileSize, character);
      highlightLayer.lineStyle(2, 0xe2e8f0, 1);
      highlightLayer.strokeRect(highlightPosition.x, highlightPosition.y, tileSize, tileSize);
    },
  };
}

function initializePhaser() {
  if (state.phaserGame) {
    return;
  }

  if (typeof Phaser === 'undefined') {
    throw new Error('Phaser failed to load');
  }

  state.phaserGame = new Phaser.Game({
    type: Phaser.CANVAS,
    width: VIEWPORT_SIZE,
    height: VIEWPORT_SIZE,
    parent: elements.gameRoot,
    backgroundColor: '#0b1120',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: false,
      pixelArt: true,
    },
    scene: {
      create() {
        state.worldRenderer = createWorldRenderer(this);
        state.worldRenderer.render(state.snapshot);
      },
    },
  });
}

function drawWorld() {
  if (!state.worldRenderer) {
    return;
  }

  state.worldRenderer.render(state.snapshot);
}

function renderSnapshot() {
  if (!state.snapshot) {
    elements.inspectBox.textContent = 'Select a character to inspect the world snapshot.';
    renderStats();
    drawWorld();
    return;
  }

  elements.inspectBox.textContent = JSON.stringify(state.snapshot, null, 2);
  elements.zoneName.textContent = state.snapshot.zone.name;
  renderChatLog();
  renderStats();
  drawWorld();
}

async function refreshSnapshot() {
  if (!state.token || !state.selectedCharacterId) {
    return;
  }

  state.snapshot = await request('/api/world/snapshot', {
    token: state.token,
    characterId: state.selectedCharacterId,
  });
  renderSnapshot();
}

async function login(username) {
  const payload = await request('/api/login', { username });
  state.token = payload.token;
  state.account = payload.account;
  state.characters = payload.characters;
  elements.characterPanel.classList.remove('hidden');
  renderCharacterList();
  setMessage(`Logged in as ${payload.account.username}. Create or select a character.`);
}

async function createCharacter(name, archetypeId) {
  const payload = await request('/api/characters', {
    token: state.token,
    name,
    archetypeId,
  });
  state.characters = payload.characters;
  renderCharacterList();
  elements.createCharacterForm.reset();
  setMessage(`Created ${payload.character.name}. Select the character to enter the world.`);
}

async function selectCharacter(characterId) {
  const payload = await request('/api/characters/select', {
    token: state.token,
    characterId,
  });
  state.selectedCharacterId = characterId;
  state.snapshot = payload.snapshot;
  elements.gamePanel.classList.remove('hidden');
  renderSnapshot();
  setMessage(`Controlling ${payload.character.name}. Move with WASD or arrow keys.`);

  if (state.pollHandle) {
    clearInterval(state.pollHandle);
  }
  state.pollHandle = window.setInterval(() => {
    refreshSnapshot().catch((error) => setMessage(error.message));
  }, 750);
}

async function move(direction) {
  if (!state.selectedCharacterId || state.moveCooldown) {
    return;
  }

  state.moveCooldown = true;
  window.setTimeout(() => {
    state.moveCooldown = false;
  }, 120);

  const payload = await request('/api/world/move', {
    token: state.token,
    characterId: state.selectedCharacterId,
    direction,
  });
  state.snapshot = payload.snapshot;
  setMessage(payload.ok ? `Moved ${direction}.` : 'Movement blocked by terrain.');
  renderSnapshot();
}

async function talkToNpc() {
  const payload = await request('/api/world/interact', {
    token: state.token,
    characterId: state.selectedCharacterId,
  });
  state.snapshot = payload.snapshot;
  state.interaction = payload.npc;
  setMessage(`${payload.npc.name}: ${payload.npc.dialog}`);
  renderSnapshot();
}

async function sendChat(message) {
  const payload = await request('/api/world/chat', {
    token: state.token,
    characterId: state.selectedCharacterId,
    message,
  });
  state.snapshot = payload.snapshot;
  setMessage('Chat sent.');
  renderSnapshot();
}

async function teleport() {
  const payload = await request('/api/admin/teleport', {
    token: state.token,
    characterId: state.selectedCharacterId,
    landmarkId: 'townSquare',
  });
  state.snapshot = payload.snapshot;
  setMessage('Teleported to the town square.');
  renderSnapshot();
}

function bindEvents() {
  elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await login(elements.username.value);
    } catch (error) {
      setMessage(error.message);
    }
  });

  elements.createCharacterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await createCharacter(elements.characterName.value, elements.archetypeSelect.value);
    } catch (error) {
      setMessage(error.message);
    }
  });

  elements.chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!elements.chatInput.value.trim()) {
      return;
    }
    try {
      await sendChat(elements.chatInput.value);
      elements.chatForm.reset();
    } catch (error) {
      setMessage(error.message);
    }
  });

  elements.interactButton.addEventListener('click', () => {
    talkToNpc().catch((error) => setMessage(error.message));
  });
  elements.teleportButton.addEventListener('click', () => {
    teleport().catch((error) => setMessage(error.message));
  });
  elements.inspectButton.addEventListener('click', () => renderSnapshot());

  window.addEventListener('keydown', (event) => {
    const direction = MOVE_KEYS[event.code];
    if (!direction || !state.selectedCharacterId) {
      return;
    }
    event.preventDefault();
    move(direction).catch((error) => setMessage(error.message));
  });
}

async function bootstrap() {
  state.bootstrap = await request('/api/bootstrap');
  renderArchetypes();
  initializePhaser();
  renderSnapshot();
  bindEvents();
  setMessage('Login with a username to start the first MMO slice.');
}

bootstrap().catch((error) => {
  setMessage(error.message);
});
