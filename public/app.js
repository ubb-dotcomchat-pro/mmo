const TILE_SIZE = 32;
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
  canvas: document.querySelector('#game-canvas'),
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

const context = elements.canvas.getContext('2d');

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
    button.type = 'button';
    button.className = 'character-card';
    button.innerHTML = `<span>${character.name} · ${character.archetypeId}</span><span>Lvl ${character.level}</span>`;
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
    line.className = 'chat-entry';
    line.innerHTML = `<strong>${entry.author}:</strong> ${entry.message}`;
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

function renderSnapshot() {
  if (!state.snapshot) {
    elements.inspectBox.textContent = 'Select a character to inspect the world snapshot.';
    return;
  }

  elements.inspectBox.textContent = JSON.stringify(state.snapshot, null, 2);
  elements.zoneName.textContent = state.snapshot.zone.name;
  renderChatLog();
  renderStats();
  drawWorld();
}

function drawWorld() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return;
  }

  const { zone, nearby, character } = snapshot;
  const scale = Math.min(elements.canvas.width / zone.width, elements.canvas.height / zone.height);
  const tileSize = Math.floor(scale);

  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  context.fillStyle = '#1f2937';
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  context.strokeStyle = '#334155';
  context.lineWidth = 1;
  for (let y = 0; y < zone.height; y += 1) {
    for (let x = 0; x < zone.width; x += 1) {
      context.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }

  context.fillStyle = '#14532d';
  for (const tile of zone.blockedTiles) {
    context.fillRect(tile.x * tileSize, tile.y * tileSize, tileSize, tileSize);
  }

  for (const landmark of zone.landmarks) {
    context.fillStyle = '#78350f';
    context.fillRect(landmark.x * tileSize, landmark.y * tileSize, tileSize, tileSize);
    context.fillStyle = '#f8fafc';
    context.font = '10px sans-serif';
    context.fillText(landmark.label, landmark.x * tileSize + 2, landmark.y * tileSize + tileSize - 6);
  }

  for (const npc of nearby.npcs) {
    context.fillStyle = '#facc15';
    context.beginPath();
    context.arc((npc.x + 0.5) * tileSize, (npc.y + 0.5) * tileSize, tileSize / 3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f8fafc';
    context.fillText(npc.name, npc.x * tileSize, npc.y * tileSize - 4);
  }

  for (const player of nearby.players) {
    context.fillStyle = player.isSelf ? '#22c55e' : '#60a5fa';
    context.beginPath();
    context.arc((player.x + 0.5) * tileSize, (player.y + 0.5) * tileSize, tileSize / 3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f8fafc';
    context.fillText(player.name, player.x * tileSize, player.y * tileSize - 4);
  }

  context.strokeStyle = '#e2e8f0';
  context.strokeRect(character.x * tileSize, character.y * tileSize, tileSize, tileSize);
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
  renderSnapshot();
  bindEvents();
  setMessage('Login with a username to start the first MMO slice.');
}

bootstrap().catch((error) => {
  setMessage(error.message);
});
