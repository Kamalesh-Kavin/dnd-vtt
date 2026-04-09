// server/index.js — Express 5 + Socket.IO server for Dungeon Crawl VTT
// Single-lobby model: one link = one game, all players join the same session

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameState = require('./game/GameState');
const DiceRoller = require('./game/DiceRoller');
const { RACES, CLASSES, WEAPONS, ARMOR, SPELLS, MONSTERS, TILE_TYPES } = require('./data/rules');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', players: game.getPlayerCount(), phase: game.phase });
});

// Game data endpoint (for character creation UI)
app.get('/api/rules', (req, res) => {
  res.json({ RACES, CLASSES, WEAPONS, ARMOR, SPELLS, MONSTERS, TILE_TYPES });
});

// ==========================================
// GAME STATE (single lobby)
// ==========================================
let game = new GameState();

// Session tracking for reconnection
const sessions = {}; // sessionId -> socketId

// ==========================================
// SOCKET.IO EVENT HANDLERS
// ==========================================
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // ---------------------------
  // RECONNECTION
  // ---------------------------
  socket.on('reconnect_session', ({ sessionId }) => {
    if (sessions[sessionId]) {
      const oldSocketId = sessions[sessionId];
      game.reconnectPlayer(oldSocketId, socket.id);
      sessions[sessionId] = socket.id;
      console.log(`Player reconnected: ${sessionId} (${oldSocketId} -> ${socket.id})`);

      // Send full state
      socket.emit('game_state', game.getSnapshot(socket.id));
      socket.emit('reconnected', { success: true });

      // Notify others
      socket.broadcast.emit('player_reconnected', {
        player: game.players[socket.id],
      });
    } else {
      socket.emit('reconnected', { success: false });
    }
  });

  // ---------------------------
  // LOBBY: JOIN
  // ---------------------------
  socket.on('join', ({ name, sessionId }) => {
    // Check if game is already in progress
    if (game.phase !== GameState.PHASE.LOBBY) {
      socket.emit('error_msg', { message: 'Game already in progress. Wait for it to end.' });
      return;
    }

    // Store session
    if (sessionId) {
      sessions[sessionId] = socket.id;
    }

    const player = game.addPlayer(socket.id, name);
    console.log(`${name} joined the lobby (${game.getPlayerCount()} players)`);

    // Send confirmation + current state
    socket.emit('joined', {
      player,
      snapshot: game.getSnapshot(socket.id),
    });

    // Notify all
    io.emit('lobby_update', {
      players: Object.values(game.players),
      playerCount: game.getPlayerCount(),
    });
  });

  // ---------------------------
  // LOBBY: SETTINGS
  // ---------------------------
  socket.on('set_dm_mode', ({ mode }) => {
    game.setDMMode(mode, mode === 'human' ? socket.id : null);
    io.emit('settings_update', {
      dmMode: game.dmMode,
      dmSocketId: game.dmSocketId,
      gameMode: game.gameMode,
      settings: game.settings,
    });
  });

  socket.on('set_game_mode', ({ mode }) => {
    game.setGameMode(mode);
    io.emit('settings_update', {
      dmMode: game.dmMode,
      gameMode: game.gameMode,
      settings: game.settings,
    });
  });

  socket.on('set_settings', (settings) => {
    game.setSettings(settings);
    io.emit('settings_update', {
      dmMode: game.dmMode,
      gameMode: game.gameMode,
      settings: game.settings,
    });
  });

  // ---------------------------
  // CHARACTER CREATION
  // ---------------------------
  socket.on('roll_ability_scores', () => {
    const scores = game.rollAbilityScores();
    socket.emit('ability_scores_rolled', { scores });
  });

  socket.on('create_character', (data) => {
    const result = game.createCharacter(socket.id, data);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }

    socket.emit('character_created', { character: result });

    // Notify all of updated lobby state
    io.emit('lobby_update', {
      players: Object.values(game.players),
      characters: game.getAllCharacters(),
      playerCount: game.getPlayerCount(),
    });
  });

  // ---------------------------
  // GAME START
  // ---------------------------
  socket.on('start_game', () => {
    const result = game.startGame();
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }

    console.log(`Game started! ${game.getPlayerCount()} players, dungeon level ${game.dungeonLevel}`);

    io.emit('game_started', {
      dungeon: result.dungeon,
      characters: result.characters,
      narrative: result.narrative,
      phase: game.phase,
    });
  });

  // ---------------------------
  // EXPLORATION: MOVEMENT
  // ---------------------------
  socket.on('move', ({ x, y }) => {
    const result = game.moveCharacter(socket.id, x, y);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }

    // Send movement to all
    io.emit('player_moved', {
      socketId: socket.id,
      from: result.from,
      to: result.to,
      revealed: result.revealed,
      fog: game.dungeon?.fog,
    });

    // Send tile events
    if (result.events.length > 0) {
      io.emit('tile_events', {
        events: result.events,
        character: game.characters[socket.id],
      });
    }

    // Monster encounter
    if (result.encounter) {
      io.emit('combat_started', {
        ...result.encounter,
        phase: game.phase,
        characters: game.getAllCharacters(),
      });
    }

    // Send updated visible monsters
    io.emit('monsters_update', {
      monsters: game.getVisibleMonsters(),
    });
  });

  // ---------------------------
  // COMBAT: ATTACK
  // ---------------------------
  socket.on('attack', ({ targetId, weaponKey }) => {
    const result = game.playerAttack(socket.id, targetId, weaponKey);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }

    io.emit('attack_result', {
      ...result,
      monsters: game.getVisibleMonsters(),
      characters: game.getAllCharacters(),
      combat: game.combat ? {
        turnOrder: game.combat.turnOrder,
        currentTurn: game.combat.getCurrentTurn(),
        round: game.combat.round,
      } : null,
      phase: game.phase,
    });
  });

  // ---------------------------
  // COMBAT: CAST SPELL
  // ---------------------------
  socket.on('cast_spell', ({ targetId, spellKey }) => {
    const result = game.playerCastSpell(socket.id, targetId, spellKey);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }

    io.emit('spell_result', {
      ...result,
      monsters: game.getVisibleMonsters(),
      characters: game.getAllCharacters(),
      combat: game.combat ? {
        turnOrder: game.combat.turnOrder,
        currentTurn: game.combat.getCurrentTurn(),
        round: game.combat.round,
      } : null,
      phase: game.phase,
    });
  });

  // ---------------------------
  // COMBAT: END TURN
  // ---------------------------
  socket.on('end_turn', () => {
    const result = game.playerEndTurn(socket.id);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }

    io.emit('turn_update', {
      ...result,
      monsters: game.getVisibleMonsters(),
      characters: game.getAllCharacters(),
      combat: game.combat ? {
        turnOrder: game.combat.turnOrder,
        currentTurn: game.combat.getCurrentTurn(),
        round: game.combat.round,
      } : null,
      phase: game.phase,
    });
  });

  // ---------------------------
  // DESCEND STAIRS
  // ---------------------------
  socket.on('descend', () => {
    const result = game.descendStairs(socket.id);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }

    io.emit('level_change', {
      ...result,
      phase: game.phase,
      monsters: game.getVisibleMonsters(),
    });
  });

  // ---------------------------
  // DICE ROLL (freeform, for chat)
  // ---------------------------
  socket.on('roll_dice', ({ notation }) => {
    const result = DiceRoller.roll(notation);
    const playerName = game.players[socket.id]?.name || 'Unknown';
    const chatMsg = game.addChatMessage(playerName, `rolls ${notation}: ${result.breakdown}`, 'roll');

    io.emit('dice_rolled', {
      player: playerName,
      notation,
      result,
      chatMsg,
    });
  });

  // ---------------------------
  // CHAT
  // ---------------------------
  socket.on('chat', ({ message }) => {
    const playerName = game.players[socket.id]?.name || 'Unknown';
    const chatMsg = game.addChatMessage(playerName, message, 'chat');
    io.emit('chat_message', chatMsg);
  });

  // ---------------------------
  // HUMAN DM ACTIONS
  // ---------------------------
  socket.on('dm_set_tile', ({ x, y, tileType }) => {
    const result = game.dmSetTile(socket.id, x, y, tileType);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }
    io.emit('tile_changed', result);
  });

  socket.on('dm_spawn_monster', ({ monsterKey, x, y }) => {
    const result = game.dmSpawnMonster(socket.id, monsterKey, x, y);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }
    io.emit('monster_spawned', { monster: result.monster });
  });

  socket.on('dm_narrate', ({ text }) => {
    const result = game.dmNarrate(socket.id, text);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }
    io.emit('chat_message', result);
  });

  socket.on('dm_reveal', ({ x, y, radius }) => {
    const result = game.dmRevealArea(socket.id, x, y, radius);
    if (result.error) {
      socket.emit('error_msg', { message: result.error });
      return;
    }
    io.emit('fog_revealed', { revealed: result.revealed, fog: game.dungeon?.fog });
  });

  // ---------------------------
  // RESET GAME
  // ---------------------------
  socket.on('reset_game', () => {
    game = new GameState();
    io.emit('game_reset', { message: 'Game has been reset.' });
    console.log('Game reset');
  });

  // ---------------------------
  // REQUEST STATE (e.g., after reload)
  // ---------------------------
  socket.on('request_state', () => {
    socket.emit('game_state', game.getSnapshot(socket.id));
  });

  // ---------------------------
  // DISCONNECT
  // ---------------------------
  socket.on('disconnect', () => {
    const player = game.players[socket.id];
    if (player) {
      player.connected = false;
      console.log(`${player.name} disconnected`);
      io.emit('player_disconnected', {
        socketId: socket.id,
        name: player.name,
        players: Object.values(game.players),
      });
    }
  });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dungeon Crawl VTT server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play`);
});
