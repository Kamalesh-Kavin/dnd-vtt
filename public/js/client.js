// client.js — D&D VTT Frontend
// Canvas renderer, socket handlers, UI logic

/* global io */

// ==========================================
// STATE
// ==========================================
const state = {
  socket: null,
  sessionId: localStorage.getItem('dnd_session') || generateSessionId(),
  mySocketId: null,
  playerName: null,
  phase: 'lobby',

  // Game data from /api/rules
  rules: null,

  // Lobby
  players: [],
  characters: [],

  // My character
  myCharacter: null,
  selectedRace: null,
  selectedClass: null,
  abilityScores: null,

  // Dungeon
  dungeon: null,
  monsters: [],
  dungeonLevel: 0,

  // Combat
  combat: null,

  // Canvas
  canvas: null,
  ctx: null,
  tileSize: 16,
  camera: { x: 0, y: 0 },
  zoom: 1.0,
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  cameraStart: { x: 0, y: 0 },
};

function generateSessionId() {
  const id = 'sess_' + Math.random().toString(36).substr(2, 12);
  localStorage.setItem('dnd_session', id);
  return id;
}

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  // Fetch rules for character creation
  try {
    const res = await fetch('/api/rules');
    state.rules = await res.json();
  } catch (e) {
    console.error('Failed to fetch rules:', e);
  }

  // Connect socket
  state.socket = io();
  state.mySocketId = state.socket.id;

  setupSocketHandlers();
  setupUIHandlers();
  setupCanvas();

  // Try reconnect
  state.socket.emit('reconnect_session', { sessionId: state.sessionId });

  // Keep-alive for Render
  setInterval(() => {
    fetch('/health').catch(() => {});
  }, 4 * 60 * 1000);
});

// ==========================================
// SOCKET HANDLERS
// ==========================================
function setupSocketHandlers() {
  const s = state.socket;

  s.on('connect', () => {
    state.mySocketId = s.id;
  });

  s.on('reconnected', (data) => {
    if (data.success) {
      addChat('System', 'Reconnected successfully!', 'system');
    }
  });

  // LOBBY
  s.on('joined', ({ player, snapshot }) => {
    state.playerName = player.name;
    applySnapshot(snapshot);
    showSection('settings-section');
    showSection('char-create-section');
    document.getElementById('join-section').classList.add('hidden');
    populateCharCreation();
  });

  s.on('lobby_update', ({ players, characters, playerCount }) => {
    state.players = players;
    if (characters) state.characters = characters;
    renderPlayerList();
    updateStartButton();
  });

  s.on('settings_update', (settings) => {
    // Update UI to reflect settings
    document.querySelectorAll('.dm-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === settings.dmMode);
    });
    document.querySelectorAll('.game-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === settings.gameMode);
    });
  });

  // CHARACTER
  s.on('ability_scores_rolled', ({ scores }) => {
    state.abilityScores = scores;
    renderAbilityScores();
    checkCharFormValid();
  });

  s.on('character_created', ({ character }) => {
    state.myCharacter = character;
    document.getElementById('char-create-section').classList.add('hidden');
    addChat('System', `${character.name} the ${character.raceName} ${character.className} is ready!`, 'system');
  });

  // GAME START
  s.on('game_started', (data) => {
    state.dungeon = data.dungeon;
    state.characters = data.characters;
    state.phase = data.phase;
    state.myCharacter = data.characters.find(c => c.socketId === state.mySocketId);
    state.dungeonLevel = 1;

    showScreen('game-screen');
    updateCharPanel();
    updatePhaseIndicator();
    centerCameraOnPlayer();
    addChat('DM', data.narrative, 'narrative');
    render();
  });

  // MOVEMENT
  s.on('player_moved', (data) => {
    const char = state.characters.find(c => c.socketId === data.socketId);
    if (char) {
      char.x = data.to.x;
      char.y = data.to.y;
    }
    if (data.fog && state.dungeon) {
      state.dungeon.fog = data.fog;
    }
    if (data.socketId === state.mySocketId) {
      state.myCharacter = state.characters.find(c => c.socketId === state.mySocketId);
    }
    render();
  });

  s.on('tile_events', ({ events, character }) => {
    // Update character HP if changed
    updateCharacterData(character);
    for (const evt of events) {
      const type = evt.type === 'trap' ? 'combat' : 'narrative';
      addChat('DM', evt.message, type);
    }
    updateCharPanel();
  });

  s.on('monsters_update', ({ monsters }) => {
    state.monsters = monsters;
    render();
  });

  // COMBAT
  s.on('combat_started', (data) => {
    state.phase = 'combat';
    state.combat = {
      turnOrder: data.turnOrder,
      currentTurn: data.turnOrder[0],
      round: 1,
    };
    state.monsters = data.monsters || state.monsters;
    state.characters = data.characters || state.characters;
    state.myCharacter = state.characters.find(c => c.socketId === state.mySocketId);

    updatePhaseIndicator();
    showCombatPanel(true);
    renderTurnOrder();
    updateCombatActions();
    render();
  });

  s.on('attack_result', (data) => {
    handleCombatResult(data);
  });

  s.on('spell_result', (data) => {
    handleCombatResult(data);
  });

  s.on('turn_update', (data) => {
    handleCombatResult(data);
  });

  // LEVEL CHANGE
  s.on('level_change', (data) => {
    state.dungeon = data.dungeon;
    state.characters = data.characters;
    state.dungeonLevel = data.dungeonLevel;
    state.monsters = data.monsters || [];
    state.phase = data.phase || 'exploring';
    state.myCharacter = state.characters.find(c => c.socketId === state.mySocketId);

    document.getElementById('dungeon-level').textContent = `Level ${state.dungeonLevel}`;
    updateCharPanel();
    centerCameraOnPlayer();
    addChat('DM', data.narrative, 'narrative');
    render();
  });

  // DICE
  s.on('dice_rolled', ({ player, notation, result, chatMsg }) => {
    document.getElementById('dice-result').innerHTML =
      `<span class="roll-value">${result.total}</span> <span>${result.breakdown}</span>`;
    addChat(chatMsg.sender, chatMsg.message, chatMsg.type);
  });

  // CHAT
  s.on('chat_message', (msg) => {
    addChat(msg.sender, msg.message, msg.type);
  });

  // FULL STATE (reconnect / request)
  s.on('game_state', (snapshot) => {
    applySnapshot(snapshot);
  });

  // ERRORS
  s.on('error_msg', ({ message }) => {
    addChat('System', message, 'system');
  });

  // GAME OVER
  s.on('game_reset', () => {
    state.phase = 'lobby';
    state.dungeon = null;
    state.combat = null;
    state.monsters = [];
    showScreen('lobby-screen');
    document.getElementById('join-section').classList.remove('hidden');
    document.getElementById('settings-section').classList.add('hidden');
  });

  // PLAYER DISCONNECT
  s.on('player_disconnected', ({ name, players }) => {
    state.players = players;
    addChat('System', `${name} disconnected`, 'system');
    renderPlayerList();
  });

  s.on('player_reconnected', ({ player }) => {
    addChat('System', `${player.name} reconnected!`, 'system');
  });

  // FOG REVEAL (DM)
  s.on('fog_revealed', ({ fog }) => {
    if (state.dungeon && fog) {
      state.dungeon.fog = fog;
      render();
    }
  });
}

// ==========================================
// UI HANDLERS
// ==========================================
function setupUIHandlers() {
  // JOIN
  document.getElementById('join-btn').addEventListener('click', joinGame);
  document.getElementById('player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinGame();
  });

  // SETTINGS
  document.querySelectorAll('.dm-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dm-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.socket.emit('set_dm_mode', { mode: btn.dataset.mode });
      const hint = document.getElementById('dm-hint');
      hint.textContent = btn.dataset.mode === 'ai'
        ? 'AI generates dungeons and narrates the adventure'
        : 'One player becomes the Dungeon Master';
    });
  });

  document.querySelectorAll('.game-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.game-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.socket.emit('set_game_mode', { mode: btn.dataset.mode });
    });
  });

  document.getElementById('difficulty-select').addEventListener('change', (e) => {
    state.socket.emit('set_settings', { difficulty: parseInt(e.target.value) });
  });

  // CHARACTER CREATION
  document.getElementById('roll-stats-btn').addEventListener('click', () => {
    state.socket.emit('roll_ability_scores');
  });

  document.getElementById('create-char-btn').addEventListener('click', createCharacter);

  // START GAME
  document.getElementById('start-game-btn').addEventListener('click', () => {
    state.socket.emit('start_game');
  });

  // COMBAT
  document.getElementById('attack-btn').addEventListener('click', () => {
    showAttackUI();
  });
  document.getElementById('spell-btn').addEventListener('click', () => {
    showSpellUI();
  });
  document.getElementById('end-turn-btn').addEventListener('click', () => {
    state.socket.emit('end_turn');
  });
  document.getElementById('confirm-attack-btn').addEventListener('click', () => {
    const targetId = document.getElementById('target-dropdown').value;
    const weaponKey = document.getElementById('weapon-dropdown').value;
    state.socket.emit('attack', { targetId, weaponKey });
    hideActionSelects();
  });
  document.getElementById('confirm-spell-btn').addEventListener('click', () => {
    const targetId = document.getElementById('target-dropdown').value;
    const spellKey = document.getElementById('spell-dropdown').value;
    state.socket.emit('cast_spell', { targetId, spellKey });
    hideActionSelects();
  });

  // DICE
  document.querySelectorAll('.dice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.socket.emit('roll_dice', { notation: btn.dataset.dice });
    });
  });

  // CHAT
  document.getElementById('chat-send-btn').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  // ZOOM
  document.getElementById('zoom-in-btn').addEventListener('click', () => {
    state.zoom = Math.min(3, state.zoom + 0.25);
    render();
  });
  document.getElementById('zoom-out-btn').addEventListener('click', () => {
    state.zoom = Math.max(0.5, state.zoom - 0.25);
    render();
  });

  // PLAY AGAIN
  document.getElementById('play-again-btn').addEventListener('click', () => {
    state.socket.emit('reset_game');
  });
}

function joinGame() {
  const nameInput = document.getElementById('player-name');
  const name = nameInput.value.trim();
  if (!name) return;

  state.socket.emit('join', { name, sessionId: state.sessionId });
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  // Check for dice commands: /roll 2d6+3
  if (msg.startsWith('/roll ')) {
    const notation = msg.slice(6).trim();
    state.socket.emit('roll_dice', { notation });
  } else {
    state.socket.emit('chat', { message: msg });
  }
  input.value = '';
}

// ==========================================
// CHARACTER CREATION
// ==========================================
function populateCharCreation() {
  if (!state.rules) return;

  // Race picker
  const racePicker = document.getElementById('race-picker');
  racePicker.innerHTML = '';
  for (const [key, race] of Object.entries(state.rules.RACES)) {
    const div = document.createElement('div');
    div.className = 'picker-option';
    div.textContent = `${race.icon} ${race.name}`;
    div.dataset.key = key;
    div.addEventListener('click', () => {
      document.querySelectorAll('#race-picker .picker-option').forEach(o => o.classList.remove('selected'));
      div.classList.add('selected');
      state.selectedRace = key;
      document.getElementById('race-desc').textContent = `${race.description} Traits: ${race.traits.join(', ')}`;
      checkCharFormValid();
    });
    racePicker.appendChild(div);
  }

  // Class picker
  const classPicker = document.getElementById('class-picker');
  classPicker.innerHTML = '';
  for (const [key, cls] of Object.entries(state.rules.CLASSES)) {
    const div = document.createElement('div');
    div.className = 'picker-option';
    div.textContent = `${cls.icon} ${cls.name}`;
    div.dataset.key = key;
    div.addEventListener('click', () => {
      document.querySelectorAll('#class-picker .picker-option').forEach(o => o.classList.remove('selected'));
      div.classList.add('selected');
      state.selectedClass = key;
      document.getElementById('class-desc').textContent = `${cls.description} Hit Die: d${cls.hitDie}, Primary: ${cls.primaryAbility.toUpperCase()}`;
      checkCharFormValid();
    });
    classPicker.appendChild(div);
  }
}

function renderAbilityScores() {
  const container = document.getElementById('ability-scores');
  container.innerHTML = '';
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  abilities.forEach((ab, i) => {
    const score = state.abilityScores ? state.abilityScores[i] : null;
    const card = document.createElement('div');
    card.className = 'ability-card';
    const val = score ? score.total : '--';
    const mod = score ? Math.floor((score.total - 10) / 2) : 0;
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;

    card.innerHTML = `
      <div class="ability-label">${ab.toUpperCase()}</div>
      <div class="ability-value">${val}</div>
      <div class="ability-mod">${score ? modStr : ''}</div>
    `;
    container.appendChild(card);
  });
}

function checkCharFormValid() {
  const name = document.getElementById('char-name').value.trim();
  const valid = name && state.selectedRace && state.selectedClass && state.abilityScores;
  document.getElementById('create-char-btn').disabled = !valid;
}

// Listen for char name changes
document.addEventListener('DOMContentLoaded', () => {
  const charName = document.getElementById('char-name');
  if (charName) {
    charName.addEventListener('input', checkCharFormValid);
  }
});

function createCharacter() {
  const name = document.getElementById('char-name').value.trim();
  if (!name || !state.selectedRace || !state.selectedClass || !state.abilityScores) return;

  const abilities = {};
  const abilityNames = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  abilityNames.forEach((ab, i) => {
    abilities[ab] = state.abilityScores[i].total;
  });

  state.socket.emit('create_character', {
    name,
    raceKey: state.selectedRace,
    classKey: state.selectedClass,
    abilityScores: abilities,
  });
}

// ==========================================
// CANVAS SETUP & RENDERING
// ==========================================
function setupCanvas() {
  state.canvas = document.getElementById('game-canvas');
  state.ctx = state.canvas.getContext('2d');

  // Resize
  function resize() {
    const parent = state.canvas.parentElement;
    state.canvas.width = parent.clientWidth;
    state.canvas.height = parent.clientHeight;
    render();
  }
  window.addEventListener('resize', resize);
  resize();

  // Mouse events for panning and clicking
  state.canvas.addEventListener('mousedown', onCanvasMouseDown);
  state.canvas.addEventListener('mousemove', onCanvasMouseMove);
  state.canvas.addEventListener('mouseup', onCanvasMouseUp);
  state.canvas.addEventListener('wheel', onCanvasWheel);
  state.canvas.addEventListener('click', onCanvasClick);

  // Touch support
  state.canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  state.canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  state.canvas.addEventListener('touchend', onTouchEnd);
}

function onCanvasMouseDown(e) {
  if (e.button === 1 || e.button === 2 || e.shiftKey) {
    // Middle click or shift+click = pan
    state.isDragging = true;
    state.dragStart = { x: e.clientX, y: e.clientY };
    state.cameraStart = { ...state.camera };
    e.preventDefault();
  }
}

function onCanvasMouseMove(e) {
  if (state.isDragging) {
    state.camera.x = state.cameraStart.x + (e.clientX - state.dragStart.x);
    state.camera.y = state.cameraStart.y + (e.clientY - state.dragStart.y);
    render();
  }
}

function onCanvasMouseUp() {
  state.isDragging = false;
}

function onCanvasWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.15 : 0.15;
  state.zoom = Math.max(0.5, Math.min(3, state.zoom + delta));
  render();
}

let lastTouchDist = 0;
function onTouchStart(e) {
  if (e.touches.length === 1) {
    state.isDragging = true;
    state.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    state.cameraStart = { ...state.camera };
  } else if (e.touches.length === 2) {
    lastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
  e.preventDefault();
}

function onTouchMove(e) {
  if (e.touches.length === 1 && state.isDragging) {
    state.camera.x = state.cameraStart.x + (e.touches[0].clientX - state.dragStart.x);
    state.camera.y = state.cameraStart.y + (e.touches[0].clientY - state.dragStart.y);
    render();
  } else if (e.touches.length === 2) {
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (lastTouchDist > 0) {
      const scale = dist / lastTouchDist;
      state.zoom = Math.max(0.5, Math.min(3, state.zoom * scale));
      render();
    }
    lastTouchDist = dist;
  }
  e.preventDefault();
}

function onTouchEnd(e) {
  if (e.touches.length === 0) {
    state.isDragging = false;
    lastTouchDist = 0;
  }
}

function onCanvasClick(e) {
  if (!state.dungeon || !state.myCharacter) return;
  if (state.isDragging) return;

  const rect = state.canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Convert screen coords to grid coords
  const ts = state.tileSize * state.zoom;
  const gridX = Math.floor((mouseX - state.camera.x) / ts);
  const gridY = Math.floor((mouseY - state.camera.y) / ts);

  if (state.phase === 'exploring') {
    // Move to clicked tile (if adjacent)
    state.socket.emit('move', { x: gridX, y: gridY });
  } else if (state.phase === 'combat') {
    // In combat, clicking a monster could select it as target
    const clickedMonster = state.monsters.find(m =>
      m.x === gridX && m.y === gridY && m.currentHP > 0
    );
    if (clickedMonster) {
      document.getElementById('target-dropdown').value = clickedMonster.id;
    }
  }
}

function centerCameraOnPlayer() {
  if (!state.myCharacter || !state.canvas) return;
  const ts = state.tileSize * state.zoom;
  state.camera.x = state.canvas.width / 2 - state.myCharacter.x * ts;
  state.camera.y = state.canvas.height / 2 - state.myCharacter.y * ts;
}

// ==========================================
// RENDERING
// ==========================================
const TILE_COLORS = {
  0: '#0a0a12',  // VOID
  1: '#3a3636',  // FLOOR
  2: '#1a1a28',  // WALL
  3: '#6b4423',  // DOOR
  4: '#c9a84c',  // STAIRS
  5: '#3a3636',  // TRAP (looks like floor — hidden!)
  6: '#c9a84c',  // CHEST
  7: '#1a3a5c',  // WATER
  8: '#0a0a12',  // PIT
};

const TILE_BORDERS = {
  2: '#2a2a3e',  // WALL border
};

function render() {
  const { canvas, ctx, dungeon, camera, zoom, tileSize } = state;
  if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!dungeon) return;

  const ts = tileSize * zoom;
  const grid = dungeon.grid;
  const fog = dungeon.fog;

  // Determine visible tile range for culling
  const startCol = Math.max(0, Math.floor(-camera.x / ts));
  const endCol = Math.min(grid[0].length, Math.ceil((canvas.width - camera.x) / ts));
  const startRow = Math.max(0, Math.floor(-camera.y / ts));
  const endRow = Math.min(grid.length, Math.ceil((canvas.height - camera.y) / ts));

  // Draw tiles
  for (let y = startRow; y < endRow; y++) {
    for (let x = startCol; x < endCol; x++) {
      const px = x * ts + camera.x;
      const py = y * ts + camera.y;

      if (!fog[y][x]) {
        // Not revealed — dark
        ctx.fillStyle = '#06060a';
        ctx.fillRect(px, py, ts, ts);
        continue;
      }

      const tile = grid[y][x];
      ctx.fillStyle = TILE_COLORS[tile] || '#3a3636';
      ctx.fillRect(px, py, ts, ts);

      // Wall borders for depth effect
      if (tile === 2) {
        ctx.strokeStyle = TILE_BORDERS[2];
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
      }

      // Special tile indicators
      if (tile === 3 && zoom >= 0.8) {
        // Door
        ctx.fillStyle = '#8b5e2b';
        ctx.fillRect(px + ts * 0.3, py + ts * 0.1, ts * 0.4, ts * 0.8);
      }
      if (tile === 4 && zoom >= 0.8) {
        // Stairs
        ctx.fillStyle = '#dbb85c';
        ctx.font = `${Math.max(8, ts * 0.6)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('>', px + ts / 2, py + ts / 2);
      }
      if (tile === 6 && zoom >= 0.8) {
        // Chest
        ctx.font = `${Math.max(8, ts * 0.6)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', px + ts / 2, py + ts / 2);
      }

      // Grid lines (subtle)
      if (zoom >= 1.0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, ts, ts);
      }
    }
  }

  // Draw monsters
  for (const monster of state.monsters) {
    if (monster.currentHP <= 0) continue;
    if (!fog[monster.y] || !fog[monster.y][monster.x]) continue;

    const px = monster.x * ts + camera.x;
    const py = monster.y * ts + camera.y;

    // Red circle for monster
    ctx.fillStyle = 'rgba(192, 57, 43, 0.7)';
    ctx.beginPath();
    ctx.arc(px + ts / 2, py + ts / 2, ts * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Monster icon
    if (zoom >= 0.8) {
      ctx.font = `${Math.max(8, ts * 0.5)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(monster.icon || 'M', px + ts / 2, py + ts / 2);
    }

    // HP bar below monster
    if (zoom >= 0.8) {
      const hpPct = monster.currentHP / monster.maxHP;
      const barW = ts * 0.8;
      const barH = 3;
      const barX = px + ts * 0.1;
      const barY = py + ts - 5;

      ctx.fillStyle = '#333';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = hpPct > 0.5 ? '#27ae60' : hpPct > 0.25 ? '#f39c12' : '#c0392b';
      ctx.fillRect(barX, barY, barW * hpPct, barH);
    }
  }

  // Draw player characters
  for (const char of state.characters) {
    if (char.currentHP <= 0) continue;

    const px = char.x * ts + camera.x;
    const py = char.y * ts + camera.y;

    // Blue/green circle for player
    const isMe = char.socketId === state.mySocketId;
    ctx.fillStyle = isMe ? 'rgba(41, 128, 185, 0.8)' : 'rgba(39, 174, 96, 0.7)';
    ctx.beginPath();
    ctx.arc(px + ts / 2, py + ts / 2, ts * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Character icon
    if (zoom >= 0.8) {
      ctx.font = `${Math.max(8, ts * 0.5)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(char.classIcon || 'P', px + ts / 2, py + ts / 2);
    }

    // Name label
    if (zoom >= 1.0) {
      ctx.font = `${Math.max(7, ts * 0.35)}px sans-serif`;
      ctx.fillStyle = isMe ? '#3498db' : '#2ecc71';
      ctx.textAlign = 'center';
      ctx.fillText(char.name, px + ts / 2, py - 3);
    }

    // Highlight current character in combat
    if (state.combat?.currentTurn?.id === char.socketId) {
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + ts / 2, py + ts / 2, ts * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ==========================================
// UI HELPERS
// ==========================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showSection(id) {
  document.getElementById(id).classList.remove('hidden');
}

function renderPlayerList() {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  document.getElementById('player-count').textContent = `(${state.players.length})`;

  for (const p of state.players) {
    const tag = document.createElement('div');
    tag.className = `player-tag${p.ready ? ' ready' : ''}`;
    tag.innerHTML = `<span class="status-dot"></span>${p.name}${!p.connected ? ' (disconnected)' : ''}`;
    list.appendChild(tag);
  }
}

function updateStartButton() {
  const btn = document.getElementById('start-game-btn');
  const allReady = state.players.length > 0 && state.players.every(p => p.ready);
  if (allReady) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

function updateCharPanel() {
  const char = state.myCharacter;
  if (!char) return;

  document.getElementById('char-info-name').textContent = `${char.classIcon || ''} ${char.name}`;
  document.getElementById('char-ac').textContent = char.ac;
  document.getElementById('char-level').textContent = char.level;

  const hpPct = Math.max(0, char.currentHP / char.maxHP);
  const hpBar = document.getElementById('hp-bar');
  hpBar.style.width = `${hpPct * 100}%`;
  hpBar.style.backgroundColor = hpPct > 0.5 ? 'var(--hp-green)' : hpPct > 0.25 ? 'var(--hp-yellow)' : 'var(--hp-red)';
  document.getElementById('hp-text').textContent = `${char.currentHP}/${char.maxHP}`;
}

function updatePhaseIndicator() {
  const el = document.getElementById('phase-indicator');
  el.textContent = state.phase === 'combat' ? 'Combat' : 'Exploring';
  el.className = state.phase === 'combat' ? 'combat' : 'exploring';
}

function showCombatPanel(show) {
  document.getElementById('combat-panel').classList.toggle('hidden', !show);
}

function renderTurnOrder() {
  if (!state.combat) return;
  const container = document.getElementById('turn-order');
  container.innerHTML = '';
  document.getElementById('combat-round').textContent = `Round ${state.combat.round}`;

  for (const t of state.combat.turnOrder) {
    const tag = document.createElement('span');
    tag.className = 'turn-tag';
    if (t.dead) tag.classList.add('dead');
    if (t.type === 'monster') tag.classList.add('monster');
    if (state.combat.currentTurn?.id === t.id) tag.classList.add('active-turn');
    tag.textContent = t.name;
    container.appendChild(tag);
  }
}

function updateCombatActions() {
  if (!state.combat) return;
  const isMyTurn = state.combat.currentTurn?.id === state.mySocketId;
  const actions = document.getElementById('combat-actions');
  actions.classList.toggle('hidden', !isMyTurn);

  if (isMyTurn) {
    // Populate target dropdown with alive monsters
    const targetDrop = document.getElementById('target-dropdown');
    targetDrop.innerHTML = '';
    for (const m of state.monsters) {
      if (m.currentHP <= 0) continue;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.icon || ''} ${m.name} (${m.currentHP}/${m.maxHP})`;
      targetDrop.appendChild(opt);
    }
    document.getElementById('target-select').classList.remove('hidden');
  }
}

function showAttackUI() {
  hideActionSelects();
  document.getElementById('target-select').classList.remove('hidden');
  document.getElementById('weapon-select').classList.remove('hidden');

  // Populate weapon dropdown
  const weaponDrop = document.getElementById('weapon-dropdown');
  weaponDrop.innerHTML = '';
  if (state.myCharacter?.equipment?.weapon && state.rules) {
    const wKey = state.myCharacter.equipment.weapon;
    const w = state.rules.WEAPONS[wKey];
    if (w) {
      const opt = document.createElement('option');
      opt.value = wKey;
      opt.textContent = `${w.name} (${w.damage} ${w.type})`;
      weaponDrop.appendChild(opt);
    }
  }
  // Add all weapons the character could use
  if (state.rules) {
    for (const [key, w] of Object.entries(state.rules.WEAPONS)) {
      if (key === state.myCharacter?.equipment?.weapon) continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${w.name} (${w.damage} ${w.type})`;
      weaponDrop.appendChild(opt);
    }
  }
}

function showSpellUI() {
  hideActionSelects();
  document.getElementById('target-select').classList.remove('hidden');
  document.getElementById('spell-select').classList.remove('hidden');

  // Populate spell dropdown
  const spellDrop = document.getElementById('spell-dropdown');
  spellDrop.innerHTML = '';
  if (state.myCharacter?.knownSpells && state.rules) {
    for (const key of state.myCharacter.knownSpells) {
      const spell = state.rules.SPELLS[key];
      if (!spell) continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${spell.name} (Lvl ${spell.level}${spell.damage ? ', ' + spell.damage + ' ' + spell.type : ''}${spell.heal ? ', heal' : ''})`;
      spellDrop.appendChild(opt);
    }
  }

  // For healing spells, add player targets
  const targetDrop = document.getElementById('target-dropdown');
  for (const char of state.characters) {
    if (char.currentHP <= 0) continue;
    const opt = document.createElement('option');
    opt.value = char.socketId;
    opt.textContent = `${char.classIcon || ''} ${char.name} (${char.currentHP}/${char.maxHP})`;
    targetDrop.appendChild(opt);
  }
}

function hideActionSelects() {
  document.getElementById('weapon-select').classList.add('hidden');
  document.getElementById('spell-select').classList.add('hidden');
}

function handleCombatResult(data) {
  if (data.monsters) state.monsters = data.monsters;
  if (data.characters) {
    state.characters = data.characters;
    state.myCharacter = state.characters.find(c => c.socketId === state.mySocketId);
  }
  if (data.combat) {
    state.combat = data.combat;
  }
  if (data.phase) {
    state.phase = data.phase;
    updatePhaseIndicator();
  }

  // Process monster actions
  if (data.monsterActions) {
    for (const action of data.monsterActions) {
      if (action.result?.narrative) {
        addChat('Combat', action.result.narrative, 'combat');
      }
      if (action.type === 'game_over') {
        showScreen('gameover-screen');
        document.getElementById('gameover-title').textContent = 'Defeat';
        document.getElementById('gameover-message').textContent = 'Your party has fallen... The dungeon claims more souls.';
      }
    }
  }

  // Victory
  if (data.combatResult === 'victory') {
    state.phase = 'exploring';
    state.combat = null;
    showCombatPanel(false);
    if (data.xpAwarded) {
      addChat('DM', `Victory! Each adventurer gains ${data.xpAwarded} XP!`, 'narrative');
    }
  }

  updateCharPanel();
  renderTurnOrder();
  updateCombatActions();
  render();
}

function updateCharacterData(charData) {
  if (!charData) return;
  const idx = state.characters.findIndex(c => c.socketId === charData.socketId);
  if (idx >= 0) {
    state.characters[idx] = charData;
  }
  if (charData.socketId === state.mySocketId) {
    state.myCharacter = charData;
  }
}

function addChat(sender, message, type = 'chat') {
  const log = document.getElementById('chat-log');
  if (!log) return;

  const div = document.createElement('div');
  div.className = `chat-msg ${type}`;
  div.innerHTML = `<span class="chat-sender">${sender}:</span> ${escapeHtml(message)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function applySnapshot(snapshot) {
  if (!snapshot) return;

  state.phase = snapshot.phase;
  state.players = snapshot.players || [];
  state.characters = snapshot.characters || [];
  state.myCharacter = snapshot.myCharacter;
  state.dungeon = snapshot.dungeon;
  state.monsters = snapshot.monsters || [];
  state.combat = snapshot.combat;
  state.dungeonLevel = snapshot.dungeonLevel || 0;

  if (state.phase === 'lobby') {
    showScreen('lobby-screen');
    renderPlayerList();
    updateStartButton();
  } else if (state.phase === 'exploring' || state.phase === 'combat') {
    showScreen('game-screen');
    updateCharPanel();
    updatePhaseIndicator();
    document.getElementById('dungeon-level').textContent = `Level ${state.dungeonLevel}`;

    if (state.phase === 'combat' && state.combat) {
      showCombatPanel(true);
      renderTurnOrder();
      updateCombatActions();
    } else {
      showCombatPanel(false);
    }

    centerCameraOnPlayer();
    render();
  } else if (state.phase === 'game_over') {
    showScreen('gameover-screen');
  }

  // Replay chat
  if (snapshot.chatLog) {
    for (const msg of snapshot.chatLog) {
      addChat(msg.sender, msg.message, msg.type);
    }
  }
}
