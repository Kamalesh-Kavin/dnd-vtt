// GameState.js — Core game state engine
// Manages lobby, characters, dungeon, fog of war, turns, and game phases

const { RACES, CLASSES, WEAPONS, ARMOR, SPELLS, SKILLS, PROFICIENCY_BONUS, abilityModifier, TILE_TYPES } = require('../data/rules');
const DiceRoller = require('./DiceRoller');
const DungeonGenerator = require('./DungeonGenerator');
const Combat = require('./Combat');

// Game phases
const PHASE = {
  LOBBY: 'lobby',           // Players joining and creating characters
  EXPLORING: 'exploring',   // Moving through dungeon, no combat
  COMBAT: 'combat',         // Turn-based combat
  SHOPPING: 'shopping',     // Between levels / rest
  GAME_OVER: 'game_over',   // TPK or victory
};

class GameState {
  constructor() {
    this.phase = PHASE.LOBBY;
    this.players = {};           // socketId -> player data
    this.characters = {};        // socketId -> character sheet
    this.dungeon = null;         // current dungeon level
    this.monsters = [];          // active monsters on the map
    this.combat = null;          // Combat instance when in combat
    this.dungeonLevel = 0;       // current floor
    this.dmMode = 'ai';         // 'ai' or 'human'
    this.dmSocketId = null;      // socket ID of human DM
    this.gameMode = 'simplified'; // 'simplified', 'faithful', 'narrative'
    this.chatLog = [];           // narrative / chat messages
    this.settings = {
      mapWidth: 50,
      mapHeight: 50,
      roomCount: 8,
      difficulty: 1,
      visionRadius: 5,
    };
  }

  // =============================
  // LOBBY
  // =============================

  addPlayer(socketId, name) {
    this.players[socketId] = {
      id: socketId,
      name,
      ready: false,
      connected: true,
      joinedAt: Date.now(),
    };
    return this.players[socketId];
  }

  removePlayer(socketId) {
    delete this.players[socketId];
    delete this.characters[socketId];
  }

  reconnectPlayer(oldSocketId, newSocketId) {
    if (this.players[oldSocketId]) {
      this.players[newSocketId] = { ...this.players[oldSocketId], id: newSocketId, connected: true };
      delete this.players[oldSocketId];
    }
    if (this.characters[oldSocketId]) {
      this.characters[newSocketId] = { ...this.characters[oldSocketId], socketId: newSocketId };
      delete this.characters[oldSocketId];
    }
  }

  getPlayerCount() {
    return Object.keys(this.players).length;
  }

  getConnectedPlayers() {
    return Object.values(this.players).filter(p => p.connected);
  }

  setDMMode(mode, socketId = null) {
    this.dmMode = mode; // 'ai' or 'human'
    this.dmSocketId = mode === 'human' ? socketId : null;
  }

  setGameMode(mode) {
    this.gameMode = mode; // 'simplified', 'faithful', 'narrative'
  }

  setSettings(settings) {
    Object.assign(this.settings, settings);
  }

  // =============================
  // CHARACTER CREATION
  // =============================

  createCharacter(socketId, { name, raceKey, classKey, abilityScores }) {
    const race = RACES[raceKey];
    const cls = CLASSES[classKey];
    if (!race || !cls) return { error: 'Invalid race or class' };

    // Apply racial bonuses to ability scores
    const abilities = { ...abilityScores };
    if (race.bonuses) {
      for (const [ability, bonus] of Object.entries(race.bonuses)) {
        abilities[ability] = (abilities[ability] || 10) + bonus;
      }
    }

    // Calculate derived stats
    const conMod = abilityModifier(abilities.con);
    const dexMod = abilityModifier(abilities.dex);
    const level = 1;
    const prof = PROFICIENCY_BONUS[level];

    // HP: class starting HP + CON modifier + racial HP bonus
    const maxHP = cls.startingHP + conMod + (race.hp_bonus * level);

    // Pick starting equipment based on class
    const equipment = this._getStartingEquipment(classKey);

    // Get available spells
    const knownSpells = [];
    if (cls.spellcaster) {
      const classSpells = Object.entries(SPELLS)
        .filter(([, s]) => s.classes.includes(classKey) && s.level === 0)
        .slice(0, cls.cantripsKnown || 2);
      knownSpells.push(...classSpells.map(([key]) => key));

      // Add first level 1 spell
      const lvl1Spells = Object.entries(SPELLS)
        .filter(([, s]) => s.classes.includes(classKey) && s.level === 1);
      if (lvl1Spells.length > 0) {
        knownSpells.push(lvl1Spells[0][0]);
      }
    }

    // Skill proficiencies (pick first 2 from class list)
    const skillProficiencies = cls.skills.slice(0, 2).map(s => s.toLowerCase().replace(/ /g, '_'));

    const character = {
      socketId,
      name,
      raceKey,
      classKey,
      raceName: race.name,
      className: cls.name,
      raceIcon: race.icon,
      classIcon: cls.icon,
      level,
      xp: 0,
      abilities,
      maxHP,
      currentHP: maxHP,
      tempHP: 0,
      ac: 10 + dexMod, // will be recalculated with armor
      speed: race.speed,
      proficiencyBonus: prof,
      hitDie: cls.hitDie,
      savingThrows: cls.savingThrows,
      skillProficiencies,
      equipment,     // { weapon: key, armor: key, shield: bool, items: [] }
      knownSpells,
      spellSlots: cls.spellSlots ? { ...cls.spellSlots } : {},
      usedSpellSlots: {},
      features: cls.features[1] || [],
      traits: race.traits || [],
      conditions: [],          // e.g., 'prone', 'stunned', 'poisoned'
      deathSaves: { successes: 0, failures: 0 },
      x: 0,  // grid position
      y: 0,
    };

    // Calculate AC with equipment
    if (equipment.armor && ARMOR[equipment.armor]) {
      character.armorData = ARMOR[equipment.armor];
      character.ac = Combat.calculateAC({
        abilities,
        armor: ARMOR[equipment.armor],
        shield: equipment.shield,
        classKey,
      });
    }

    this.characters[socketId] = character;
    this.players[socketId].ready = true;

    return character;
  }

  _getStartingEquipment(classKey) {
    const kits = {
      fighter:   { weapon: 'longsword', armor: 'chain_mail', shield: true, items: ['torch', 'rations'] },
      wizard:    { weapon: 'quarterstaff', armor: null, shield: false, items: ['spellbook', 'component pouch', 'torch'] },
      rogue:     { weapon: 'rapier', armor: 'leather', shield: false, items: ['thieves tools', 'torch', 'rope'] },
      cleric:    { weapon: 'mace', armor: 'scale_mail', shield: true, items: ['holy symbol', 'torch', 'rations'] },
      ranger:    { weapon: 'longbow', armor: 'leather', shield: false, items: ['quiver (20 arrows)', 'rope', 'torch'] },
      barbarian: { weapon: 'greatsword', armor: null, shield: false, items: ['javelin ×4', 'torch', 'rations'] },
      bard:      { weapon: 'rapier', armor: 'leather', shield: false, items: ['lute', 'torch', 'rations'] },
      paladin:   { weapon: 'longsword', armor: 'chain_mail', shield: true, items: ['holy symbol', 'torch', 'rations'] },
    };
    return kits[classKey] || kits.fighter;
  }

  // Roll ability scores for character creation
  rollAbilityScores() {
    return DiceRoller.rollAbilityScores();
  }

  // Get character data (safe to send to client)
  getCharacter(socketId) {
    return this.characters[socketId] || null;
  }

  getAllCharacters() {
    return Object.values(this.characters);
  }

  // =============================
  // DUNGEON / EXPLORATION
  // =============================

  startGame() {
    // Check all players are ready
    const players = Object.values(this.players);
    const allReady = players.every(p => p.ready);
    if (!allReady) return { error: 'Not all players are ready' };
    if (players.length === 0) return { error: 'No players' };

    this.dungeonLevel = 1;
    this.generateDungeon();
    this.phase = PHASE.EXPLORING;

    // Place all characters at the start position
    const start = this.dungeon.startPos;
    for (const char of Object.values(this.characters)) {
      char.x = start.x;
      char.y = start.y;
    }

    // Reveal fog around start position
    for (const char of Object.values(this.characters)) {
      DungeonGenerator.revealFog(
        this.dungeon.fog, char.x, char.y,
        this.dungeon.grid, this.settings.visionRadius
      );
    }

    const narrative = this._generateEntryNarrative();
    this.addChatMessage('DM', narrative, 'narrative');

    return {
      dungeon: this.getClientDungeon(),
      characters: this.getAllCharacters(),
      narrative,
    };
  }

  generateDungeon() {
    this.dungeon = DungeonGenerator.generate(
      this.settings.mapWidth,
      this.settings.mapHeight,
      {
        roomCount: this.settings.roomCount,
        difficulty: this.settings.difficulty + Math.floor(this.dungeonLevel / 2),
        monsterDensity: 0.3 + (this.dungeonLevel * 0.1),
        trapChance: 0.05 + (this.dungeonLevel * 0.02),
        chestChance: 0.1,
      }
    );

    // Set up monsters array
    this.monsters = this.dungeon.monsterPlacements.map(m => ({
      ...m,
      conditions: [],
      visible: false, // hidden until player sees them
    }));
  }

  // Move a character on the grid
  moveCharacter(socketId, targetX, targetY) {
    if (this.phase !== PHASE.EXPLORING) {
      return { error: 'Cannot move outside exploration phase' };
    }

    const char = this.characters[socketId];
    if (!char) return { error: 'Character not found' };

    const grid = this.dungeon.grid;

    // Validate target position
    if (targetY < 0 || targetY >= grid.length || targetX < 0 || targetX >= grid[0].length) {
      return { error: 'Out of bounds' };
    }

    const targetTile = grid[targetY][targetX];
    if (targetTile === TILE_TYPES.WALL || targetTile === TILE_TYPES.VOID) {
      return { error: 'Cannot walk through walls' };
    }

    // Check distance (must be adjacent — 1 tile in any direction including diagonal)
    const dx = Math.abs(targetX - char.x);
    const dy = Math.abs(targetY - char.y);
    if (dx > 1 || dy > 1) {
      return { error: 'Too far — move one tile at a time' };
    }

    // Move character
    const oldX = char.x;
    const oldY = char.y;
    char.x = targetX;
    char.y = targetY;

    // Reveal fog of war
    const revealed = DungeonGenerator.revealFog(
      this.dungeon.fog, char.x, char.y,
      this.dungeon.grid, this.settings.visionRadius
    );

    // Check for events at new position
    const events = this._checkTileEvents(char, targetX, targetY);

    // Check for monster encounters (any visible monster within 2 tiles of any player)
    const encounter = this._checkEncounters();

    return {
      moved: true,
      from: { x: oldX, y: oldY },
      to: { x: targetX, y: targetY },
      revealed,
      events,
      encounter,
    };
  }

  _checkTileEvents(char, x, y) {
    const events = [];
    const tile = this.dungeon.grid[y][x];

    if (tile === TILE_TYPES.TRAP) {
      // Perception check to notice trap
      const perceptionMod = abilityModifier(char.abilities.wis);
      const check = DiceRoller.rollSkillCheck(perceptionMod, char.skillProficiencies.includes('perception') ? char.proficiencyBonus : 0);
      if (check.total < 12) {
        // Trap triggers!
        const trapDmg = DiceRoller.roll('1d6');
        char.currentHP = Math.max(0, char.currentHP - trapDmg.total);
        events.push({
          type: 'trap',
          message: `${char.name} triggers a trap! Takes ${trapDmg.total} damage! (Perception: ${check.total})`,
          damage: trapDmg.total,
        });
        // Remove trap (triggered)
        this.dungeon.grid[y][x] = TILE_TYPES.FLOOR;
      } else {
        events.push({
          type: 'trap_noticed',
          message: `${char.name} notices a trap on the floor! (Perception: ${check.total})`,
        });
      }
    }

    if (tile === TILE_TYPES.CHEST) {
      // Loot! Generate random treasure
      const loot = this._generateLoot();
      events.push({
        type: 'chest',
        message: `${char.name} opens a chest and finds: ${loot.description}!`,
        loot,
      });
      // Remove chest (looted)
      this.dungeon.grid[y][x] = TILE_TYPES.FLOOR;
    }

    if (tile === TILE_TYPES.STAIRS) {
      events.push({
        type: 'stairs',
        message: `${char.name} finds stairs leading deeper into the dungeon!`,
      });
    }

    if (tile === TILE_TYPES.DOOR) {
      events.push({
        type: 'door',
        message: `${char.name} opens a door.`,
      });
    }

    return events;
  }

  _checkEncounters() {
    const chars = Object.values(this.characters).filter(c => c.currentHP > 0);
    const nearbyMonsters = [];

    for (const monster of this.monsters) {
      if (monster.currentHP <= 0) continue;

      for (const char of chars) {
        const dist = Math.abs(char.x - monster.x) + Math.abs(char.y - monster.y);
        if (dist <= 6 && this.dungeon.fog[monster.y][monster.x]) {
          monster.visible = true;
          if (!nearbyMonsters.includes(monster)) {
            nearbyMonsters.push(monster);
          }
        }
      }
    }

    // If any monster is within 2 tiles of any player and not already in combat
    const closeMonsters = nearbyMonsters.filter(m => {
      return chars.some(c => Math.abs(c.x - m.x) + Math.abs(c.y - m.y) <= 2);
    });

    if (closeMonsters.length > 0 && this.phase !== PHASE.COMBAT) {
      return this._startCombat(closeMonsters);
    }

    return null;
  }

  _generateLoot() {
    const roll = Math.random();
    if (roll < 0.3) {
      // Gold
      const gold = DiceRoller.roll('3d6').total * 10;
      return { type: 'gold', amount: gold, description: `${gold} gold pieces` };
    } else if (roll < 0.6) {
      // Healing potion
      return { type: 'item', name: 'Potion of Healing', effect: 'heal_2d4+2', description: 'a Potion of Healing (2d4+2 HP)' };
    } else if (roll < 0.8) {
      // Random weapon
      const weaponKeys = Object.keys(WEAPONS);
      const key = weaponKeys[Math.floor(Math.random() * weaponKeys.length)];
      return { type: 'weapon', key, name: WEAPONS[key].name, description: `a ${WEAPONS[key].name}` };
    } else {
      // Scroll or trinket
      return { type: 'item', name: 'Mysterious Scroll', effect: 'random_spell', description: 'a mysterious scroll' };
    }
  }

  // =============================
  // COMBAT
  // =============================

  _startCombat(monsters) {
    this.phase = PHASE.COMBAT;
    this.combat = new Combat();

    // Build combatant list
    const combatants = [];

    // Add players
    for (const char of Object.values(this.characters)) {
      if (char.currentHP <= 0) continue;
      combatants.push({
        id: char.socketId,
        name: char.name,
        type: 'player',
        dexMod: abilityModifier(char.abilities.dex),
      });
    }

    // Add monsters
    for (const monster of monsters) {
      combatants.push({
        id: monster.id,
        name: monster.name,
        type: 'monster',
        dexMod: abilityModifier(monster.dex || 10),
      });
    }

    const result = this.combat.startCombat(combatants);

    const monsterNames = monsters.map(m => m.name).join(', ');
    this.addChatMessage('DM', `Combat begins! You face: ${monsterNames}!`, 'combat');

    const combatResult = {
      combat: true,
      turnOrder: result.turnOrder,
      currentTurn: result.currentTurn,
      monsters: monsters.map(m => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        x: m.x,
        y: m.y,
        currentHP: m.currentHP,
        maxHP: m.maxHP,
      })),
    };

    // If the first turn is a monster, auto-execute all monster turns
    if (result.currentTurn?.type === 'monster') {
      combatResult.monsterActions = this._executeMonsterTurns();
      // Update current turn after monster actions
      if (this.combat) {
        combatResult.currentTurn = this.combat.getCurrentTurn();
        combatResult.turnOrder = this.combat.turnOrder;
        combatResult.round = this.combat.round;
      }
    }

    return combatResult;
  }

  // Player performs an attack action
  playerAttack(socketId, targetId, weaponKey) {
    if (this.phase !== PHASE.COMBAT) return { error: 'Not in combat' };
    const currentTurn = this.combat.getCurrentTurn();
    if (!currentTurn || currentTurn.id !== socketId) return { error: 'Not your turn' };

    const char = this.characters[socketId];
    const target = this.monsters.find(m => m.id === targetId);
    if (!char || !target) return { error: 'Invalid attacker or target' };

    const toHitMod = Combat.calculateToHit(char, weaponKey);
    const result = this.combat.resolveAttack(
      { name: char.name, id: socketId, toHitMod },
      { name: target.name, id: targetId, ac: target.ac, currentHP: target.currentHP, maxHP: target.maxHP },
      weaponKey
    );

    // Apply damage
    if (result.hit && result.damage) {
      target.currentHP = result.targetHP;
      if (result.killed) {
        const combatResult = this.combat.removeCombatant(targetId);
        result.combatOver = combatResult.combatOver;
        result.combatResult = combatResult.result;

        // Award XP
        if (target.xp) {
          const xpPerPlayer = Math.floor(target.xp / Object.keys(this.characters).length);
          for (const c of Object.values(this.characters)) {
            c.xp += xpPerPlayer;
          }
          result.xpAwarded = xpPerPlayer;
        }
      }
    }

    this.addChatMessage('Combat', result.narrative, 'combat');

    // End turn after attack (simplified — 1 action per turn)
    if (!result.combatOver) {
      const nextTurn = this.combat.endTurn();
      result.nextTurn = nextTurn;

      // If next turn is a monster, auto-execute it
      if (nextTurn.currentTurn?.type === 'monster') {
        result.monsterActions = this._executeMonsterTurns();
      }
    } else if (result.combatResult === 'victory') {
      this.phase = PHASE.EXPLORING;
      this.combat = null;
      this.addChatMessage('DM', 'Victory! The enemies are defeated. You may continue exploring.', 'narrative');
    }

    return result;
  }

  // Player casts a spell
  playerCastSpell(socketId, targetId, spellKey) {
    if (this.phase !== PHASE.COMBAT && this.phase !== PHASE.EXPLORING) return { error: 'Cannot cast spells now' };
    if (this.phase === PHASE.COMBAT) {
      const currentTurn = this.combat.getCurrentTurn();
      if (!currentTurn || currentTurn.id !== socketId) return { error: 'Not your turn' };
    }

    const char = this.characters[socketId];
    if (!char) return { error: 'Character not found' };

    const spell = SPELLS[spellKey];
    if (!spell) return { error: 'Unknown spell' };
    if (!char.knownSpells.includes(spellKey)) return { error: 'You don\'t know that spell' };

    // Check spell slots for non-cantrips
    if (spell.level > 0) {
      const slotsAvailable = (char.spellSlots[spell.level] || 0) - (char.usedSpellSlots[spell.level] || 0);
      if (slotsAvailable <= 0) return { error: 'No spell slots remaining' };
      char.usedSpellSlots[spell.level] = (char.usedSpellSlots[spell.level] || 0) + 1;
    }

    // Find target
    let target = null;
    if (spell.heal) {
      // Healing targets a player
      target = Object.values(this.characters).find(c => c.socketId === targetId);
    } else if (spell.damage) {
      // Damage targets a monster
      target = this.monsters.find(m => m.id === targetId);
    }

    const spellMod = Combat.calculateSpellMod(Object.assign({}, char, { classData: CLASSES[char.classKey] }));

    const result = this.combat
      ? this.combat.resolveSpell(
          { name: char.name, spellMod, proficiencyBonus: char.proficiencyBonus },
          target ? { name: target.name, ac: target.ac, currentHP: target.currentHP, maxHP: target.maxHP, dex: target.abilities?.dex || target.dex || 10 } : null,
          spellKey
        )
      : { hit: true, narrative: `${char.name} casts ${spell.name}!` };

    // Apply effects
    if (result.hit && result.damage && target) {
      target.currentHP = result.targetHP;
      if (result.killed && this.combat) {
        const combatResult = this.combat.removeCombatant(targetId);
        result.combatOver = combatResult.combatOver;
        result.combatResult = combatResult.result;
      }
    }
    if (result.healing && target) {
      target.currentHP = result.targetHP;
    }

    this.addChatMessage('Combat', result.narrative, 'combat');

    // End turn in combat
    if (this.phase === PHASE.COMBAT && !result.combatOver) {
      const nextTurn = this.combat.endTurn();
      result.nextTurn = nextTurn;
      if (nextTurn.currentTurn?.type === 'monster') {
        result.monsterActions = this._executeMonsterTurns();
      }
    } else if (result.combatResult === 'victory') {
      this.phase = PHASE.EXPLORING;
      this.combat = null;
    }

    return result;
  }

  // Execute all consecutive monster turns
  _executeMonsterTurns() {
    const actions = [];
    let safety = 0;

    while (this.combat && this.combat.active && safety < 20) {
      safety++;
      const turn = this.combat.getCurrentTurn();
      if (!turn || turn.type !== 'monster') break;

      const monster = this.monsters.find(m => m.id === turn.id);
      if (!monster || monster.currentHP <= 0) {
        this.combat.endTurn();
        continue;
      }

      const players = Object.values(this.characters).filter(c => c.currentHP > 0);
      const decision = this.combat.monsterAction(monster, players, this.dungeon?.grid);

      if (decision.action === 'attack') {
        const target = decision.target;
        const result = this.combat.resolveMonsterAttack(monster, target, decision.attack);

        if (result.hit && result.damage) {
          target.currentHP = result.targetHP;
          if (result.killed) {
            // Player downed — they'll make death saves on their turn
            this.addChatMessage('Combat', `${target.name} falls unconscious!`, 'combat');
          }
        }

        actions.push({
          monsterId: monster.id,
          monsterName: monster.name,
          action: 'attack',
          result,
        });

        this.addChatMessage('Combat', result.narrative, 'combat');
      } else if (decision.action === 'move') {
        // Simple pathfinding: move toward target
        const target = decision.target;
        const dx = Math.sign(target.x - monster.x);
        const dy = Math.sign(target.y - monster.y);
        const newX = monster.x + dx;
        const newY = monster.y + dy;

        if (this.dungeon.grid[newY]?.[newX] !== TILE_TYPES.WALL) {
          monster.x = newX;
          monster.y = newY;
        }

        actions.push({
          monsterId: monster.id,
          monsterName: monster.name,
          action: 'move',
          to: { x: monster.x, y: monster.y },
        });
      }

      // Check if all players are down
      const alivePlayers = Object.values(this.characters).filter(c => c.currentHP > 0);
      if (alivePlayers.length === 0) {
        this.phase = PHASE.GAME_OVER;
        this.addChatMessage('DM', 'The party has fallen... Game over.', 'narrative');
        actions.push({ type: 'game_over', result: 'defeat' });
        return actions;
      }

      const nextTurn = this.combat.endTurn();
      if (!nextTurn.currentTurn || nextTurn.currentTurn.type === 'player') break;
    }

    return actions;
  }

  // Player ends their turn (skip / no action)
  playerEndTurn(socketId) {
    if (this.phase !== PHASE.COMBAT || !this.combat) return { error: 'Not in combat' };
    const turn = this.combat.getCurrentTurn();
    if (!turn || turn.id !== socketId) return { error: 'Not your turn' };

    const nextTurn = this.combat.endTurn();
    const result = { nextTurn };

    if (nextTurn.currentTurn?.type === 'monster') {
      result.monsterActions = this._executeMonsterTurns();
    }

    return result;
  }

  // Descend stairs to next level
  descendStairs(socketId) {
    if (this.phase !== PHASE.EXPLORING) return { error: 'Cannot descend now' };
    const char = this.characters[socketId];
    if (!char) return { error: 'Character not found' };

    // Check if character is on stairs
    if (this.dungeon.grid[char.y]?.[char.x] !== TILE_TYPES.STAIRS) {
      return { error: 'Not on stairs' };
    }

    // Short rest: restore some HP and spell slots
    for (const c of Object.values(this.characters)) {
      const healAmount = DiceRoller.roll(`1d${c.hitDie}`).total;
      c.currentHP = Math.min(c.maxHP, c.currentHP + healAmount);
      c.usedSpellSlots = {};
      c.deathSaves = { successes: 0, failures: 0 };
    }

    this.dungeonLevel++;
    this.generateDungeon();

    // Place characters at new start
    const start = this.dungeon.startPos;
    for (const c of Object.values(this.characters)) {
      c.x = start.x;
      c.y = start.y;
    }

    // Reveal fog
    for (const c of Object.values(this.characters)) {
      DungeonGenerator.revealFog(
        this.dungeon.fog, c.x, c.y,
        this.dungeon.grid, this.settings.visionRadius
      );
    }

    const narrative = `The party descends to dungeon level ${this.dungeonLevel}. The air grows colder and the darkness deeper...`;
    this.addChatMessage('DM', narrative, 'narrative');

    return {
      dungeonLevel: this.dungeonLevel,
      dungeon: this.getClientDungeon(),
      characters: this.getAllCharacters(),
      narrative,
    };
  }

  // =============================
  // CHAT / NARRATIVE
  // =============================

  addChatMessage(sender, message, type = 'chat') {
    const entry = { sender, message, type, time: Date.now() };
    this.chatLog.push(entry);
    // Keep last 200 messages
    if (this.chatLog.length > 200) {
      this.chatLog = this.chatLog.slice(-200);
    }
    return entry;
  }

  // =============================
  // CLIENT DATA (safe to send)
  // =============================

  getClientDungeon() {
    if (!this.dungeon) return null;
    return {
      width: this.dungeon.width,
      height: this.dungeon.height,
      grid: this.dungeon.grid,
      fog: this.dungeon.fog,
      rooms: this.dungeon.rooms,
      startPos: this.dungeon.startPos,
      stairsPos: this.dungeon.stairsPos,
    };
  }

  getVisibleMonsters() {
    return this.monsters
      .filter(m => m.currentHP > 0 && m.visible)
      .map(m => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        x: m.x,
        y: m.y,
        currentHP: m.currentHP,
        maxHP: m.maxHP,
        size: m.size,
      }));
  }

  // Full game state snapshot for client
  getSnapshot(socketId = null) {
    return {
      phase: this.phase,
      dmMode: this.dmMode,
      gameMode: this.gameMode,
      dungeonLevel: this.dungeonLevel,
      players: Object.values(this.players),
      characters: this.getAllCharacters(),
      myCharacter: socketId ? this.characters[socketId] || null : null,
      dungeon: this.getClientDungeon(),
      monsters: this.getVisibleMonsters(),
      combat: this.combat ? {
        active: this.combat.active,
        turnOrder: this.combat.turnOrder,
        currentTurn: this.combat.getCurrentTurn(),
        round: this.combat.round,
        log: this.combat.getLog().slice(-20),
      } : null,
      chatLog: this.chatLog.slice(-50),
      settings: this.settings,
    };
  }

  // =============================
  // NARRATIVE HELPERS
  // =============================

  _generateEntryNarrative() {
    const narratives = [
      'You descend into the darkness of the dungeon. Torchlight flickers against ancient stone walls. The air is thick with dust and the scent of old magic...',
      'The heavy iron door creaks open, revealing a labyrinth of forgotten chambers. Strange echoes bounce off the walls ahead...',
      'Your footsteps echo as you enter the dungeon. Cobwebs hang from the ceiling and bones litter the floor. Something stirs in the darkness ahead...',
      'The entrance to the dungeon yawns before you like the maw of a great beast. You steel your nerves and step inside...',
    ];
    return narratives[Math.floor(Math.random() * narratives.length)];
  }

  // =============================
  // HUMAN DM ACTIONS
  // =============================

  // DM can manually place/modify the grid (human DM mode)
  dmSetTile(socketId, x, y, tileType) {
    if (this.dmMode !== 'human' || this.dmSocketId !== socketId) {
      return { error: 'Not the DM' };
    }
    if (!this.dungeon) return { error: 'No dungeon active' };
    if (y < 0 || y >= this.dungeon.height || x < 0 || x >= this.dungeon.width) {
      return { error: 'Out of bounds' };
    }
    this.dungeon.grid[y][x] = tileType;
    return { success: true, x, y, tileType };
  }

  // DM can spawn a monster
  dmSpawnMonster(socketId, monsterKey, x, y) {
    if (this.dmMode !== 'human' || this.dmSocketId !== socketId) {
      return { error: 'Not the DM' };
    }
    const { MONSTERS } = require('../data/rules');
    const template = MONSTERS[monsterKey];
    if (!template) return { error: 'Unknown monster' };

    const monster = {
      ...template,
      monsterKey,
      x,
      y,
      currentHP: template.hp,
      maxHP: template.hp,
      id: `monster_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      visible: true,
      conditions: [],
    };

    this.monsters.push(monster);
    return { success: true, monster };
  }

  // DM sends narrative text
  dmNarrate(socketId, text) {
    if (this.dmMode !== 'human' || this.dmSocketId !== socketId) {
      return { error: 'Not the DM' };
    }
    return this.addChatMessage('DM', text, 'narrative');
  }

  // DM reveals fog in an area
  dmRevealArea(socketId, x, y, radius) {
    if (this.dmMode !== 'human' || this.dmSocketId !== socketId) {
      return { error: 'Not the DM' };
    }
    if (!this.dungeon) return { error: 'No dungeon' };

    const revealed = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (ny >= 0 && ny < this.dungeon.height && nx >= 0 && nx < this.dungeon.width) {
          if (!this.dungeon.fog[ny][nx]) {
            this.dungeon.fog[ny][nx] = true;
            revealed.push({ x: nx, y: ny });
          }
        }
      }
    }
    return { success: true, revealed };
  }
}

// Export the PHASE enum along with the class
GameState.PHASE = PHASE;
module.exports = GameState;
