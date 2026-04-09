// Combat.js — D&D 5e combat engine
// Handles initiative, turns, attacks, damage, death saves, and conditions

const DiceRoller = require('./DiceRoller');
const { abilityModifier, WEAPONS, SPELLS, PROFICIENCY_BONUS } = require('../data/rules');

class Combat {
  constructor() {
    this.active = false;
    this.turnOrder = [];    // sorted by initiative, each { id, name, initiative, type: 'player'|'monster' }
    this.currentTurnIdx = 0;
    this.round = 0;
    this.log = [];          // combat event log
  }

  // Start combat: roll initiative for all combatants
  // combatants: [{ id, name, type, dexMod, ... }]
  startCombat(combatants) {
    this.active = true;
    this.round = 1;
    this.currentTurnIdx = 0;
    this.log = [];
    this.turnOrder = [];

    for (const c of combatants) {
      const init = DiceRoller.rollInitiative(c.dexMod || 0);
      this.turnOrder.push({
        id: c.id,
        name: c.name,
        type: c.type,
        initiative: init.total,
        initRoll: init,
      });
    }

    // Sort descending by initiative (higher goes first), break ties by DEX mod
    this.turnOrder.sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return (b.dexMod || 0) - (a.dexMod || 0);
    });

    this._log(`Combat begins! Round ${this.round}`);
    this._log(`Turn order: ${this.turnOrder.map(t => `${t.name}(${t.initiative})`).join(', ')}`);

    return {
      turnOrder: this.turnOrder,
      currentTurn: this.turnOrder[0],
      round: this.round,
    };
  }

  // Get whose turn it is
  getCurrentTurn() {
    if (!this.active) return null;
    return this.turnOrder[this.currentTurnIdx] || null;
  }

  // End current turn, advance to next
  endTurn() {
    this.currentTurnIdx++;
    if (this.currentTurnIdx >= this.turnOrder.length) {
      this.currentTurnIdx = 0;
      this.round++;
      this._log(`--- Round ${this.round} ---`);
    }

    // Skip dead combatants
    let safety = 0;
    while (this.turnOrder[this.currentTurnIdx]?.dead && safety < this.turnOrder.length) {
      this.currentTurnIdx++;
      if (this.currentTurnIdx >= this.turnOrder.length) {
        this.currentTurnIdx = 0;
        this.round++;
      }
      safety++;
    }

    const current = this.getCurrentTurn();
    if (current) {
      this._log(`${current.name}'s turn`);
    }

    return {
      currentTurn: current,
      round: this.round,
    };
  }

  // Remove a combatant from turn order (e.g., fled or killed)
  removeCombatant(id) {
    const idx = this.turnOrder.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.turnOrder[idx].dead = true;
    }

    // Check if combat is over
    const aliveMonsters = this.turnOrder.filter(t => t.type === 'monster' && !t.dead);
    const alivePlayers = this.turnOrder.filter(t => t.type === 'player' && !t.dead);

    if (aliveMonsters.length === 0) {
      this._log('All enemies defeated! Combat ends.');
      this.active = false;
      return { combatOver: true, result: 'victory' };
    }
    if (alivePlayers.length === 0) {
      this._log('All players have fallen... Total party kill.');
      this.active = false;
      return { combatOver: true, result: 'defeat' };
    }

    return { combatOver: false };
  }

  // Resolve a melee/ranged weapon attack
  // attacker: { name, id, toHitMod, proficiencyBonus }
  // target: { name, id, ac, currentHP, maxHP }
  // weaponKey: key from WEAPONS
  resolveAttack(attacker, target, weaponKey, advantage = false, disadvantage = false) {
    const weapon = WEAPONS[weaponKey];
    if (!weapon) {
      return { success: false, error: `Unknown weapon: ${weaponKey}` };
    }

    // Calculate to-hit modifier
    // For simplicity: ability mod + proficiency
    const toHitMod = attacker.toHitMod || 0;

    // Roll attack
    const attackRoll = DiceRoller.rollAttack(toHitMod, advantage, disadvantage);

    const result = {
      attacker: attacker.name,
      target: target.name,
      weapon: weapon.name,
      attackRoll,
      hit: false,
      damage: null,
    };

    // Critical fail always misses
    if (attackRoll.critFail) {
      this._log(`${attacker.name} attacks ${target.name} with ${weapon.name} — CRITICAL MISS! (${attackRoll.breakdown})`);
      result.narrative = `${attacker.name} swings wildly with their ${weapon.name} and completely misses!`;
      return result;
    }

    // Check if attack hits (>= target AC, or critical hit)
    if (attackRoll.critical || attackRoll.total >= target.ac) {
      result.hit = true;

      // Roll damage
      const damageRoll = DiceRoller.rollDamage(weapon.damage, attackRoll.critical);
      result.damage = damageRoll;

      // Apply damage
      const newHP = Math.max(0, target.currentHP - damageRoll.total);
      result.targetHP = newHP;
      result.killed = newHP <= 0;

      if (attackRoll.critical) {
        this._log(`${attacker.name} CRITICALLY HITS ${target.name} with ${weapon.name}! ${damageRoll.total} ${weapon.type} damage! (${attackRoll.breakdown}, dmg: ${damageRoll.breakdown})`);
        result.narrative = `${attacker.name} delivers a devastating blow with their ${weapon.name}! ${damageRoll.total} damage!`;
      } else {
        this._log(`${attacker.name} hits ${target.name} with ${weapon.name} for ${damageRoll.total} ${weapon.type} damage. (${attackRoll.breakdown}, dmg: ${damageRoll.breakdown})`);
        result.narrative = `${attacker.name} strikes ${target.name} with their ${weapon.name} for ${damageRoll.total} damage.`;
      }

      if (result.killed) {
        this._log(`${target.name} falls!`);
        result.narrative += ` ${target.name} collapses to the ground!`;
      }
    } else {
      this._log(`${attacker.name} attacks ${target.name} with ${weapon.name} — miss! (${attackRoll.breakdown} vs AC ${target.ac})`);
      result.narrative = `${attacker.name} swings at ${target.name} with their ${weapon.name}, but the attack glances off.`;
    }

    return result;
  }

  // Resolve a spell attack or save-based spell
  resolveSpell(caster, target, spellKey) {
    const spell = SPELLS[spellKey];
    if (!spell) {
      return { success: false, error: `Unknown spell: ${spellKey}` };
    }

    const result = {
      caster: caster.name,
      target: target?.name || 'area',
      spell: spell.name,
      hit: false,
      damage: null,
      healing: null,
    };

    // Healing spells
    if (spell.heal) {
      const healRoll = DiceRoller.roll(spell.heal.replace('mod', String(caster.spellMod || 0)));
      const healed = Math.min(healRoll.total, target.maxHP - target.currentHP);
      result.healing = { rolled: healRoll.total, actual: healed };
      result.targetHP = Math.min(target.maxHP, target.currentHP + healed);
      result.hit = true;
      this._log(`${caster.name} casts ${spell.name} on ${target.name}, healing ${healed} HP! (${healRoll.breakdown})`);
      result.narrative = `${caster.name} channels divine energy, healing ${target.name} for ${healed} hit points!`;
      return result;
    }

    // Damage spells
    if (spell.damage) {
      // Spell attack roll (ranged spell attack) or save
      if (spell.description.includes('spell attack') || spell.description.includes('Ranged')) {
        // Spell attack roll
        const spellMod = caster.spellMod || 0;
        const prof = caster.proficiencyBonus || 2;
        const attackRoll = DiceRoller.rollAttack(spellMod + prof);

        result.attackRoll = attackRoll;

        if (attackRoll.critFail) {
          this._log(`${caster.name} casts ${spell.name} at ${target.name} — miss! (${attackRoll.breakdown})`);
          result.narrative = `${caster.name} hurls ${spell.name} but it goes wide!`;
          return result;
        }

        if (attackRoll.critical || attackRoll.total >= target.ac) {
          result.hit = true;
          const dmgRoll = DiceRoller.rollDamage(spell.damage, attackRoll.critical);
          result.damage = dmgRoll;
          const newHP = Math.max(0, target.currentHP - dmgRoll.total);
          result.targetHP = newHP;
          result.killed = newHP <= 0;

          this._log(`${caster.name} hits ${target.name} with ${spell.name} for ${dmgRoll.total} ${spell.type} damage!`);
          result.narrative = `${caster.name} blasts ${target.name} with ${spell.name} for ${dmgRoll.total} ${spell.type} damage!`;

          if (result.killed) {
            result.narrative += ` ${target.name} is destroyed!`;
          }
        } else {
          this._log(`${caster.name} casts ${spell.name} at ${target.name} — miss! (${attackRoll.breakdown} vs AC ${target.ac})`);
          result.narrative = `${caster.name}'s ${spell.name} misses ${target.name}!`;
        }
      } else {
        // Save-based spell (e.g., Sacred Flame, Burning Hands)
        // Target makes a saving throw
        const saveMod = abilityModifier(target.dex || 10); // usually DEX save
        const saveRoll = DiceRoller.rollSave(saveMod);
        const spellDC = 8 + (caster.proficiencyBonus || 2) + (caster.spellMod || 0);

        result.saveRoll = saveRoll;
        result.spellDC = spellDC;

        const dmgRoll = DiceRoller.roll(spell.damage);

        if (saveRoll.total >= spellDC) {
          // Save success: half damage (or no damage for cantrips)
          const isCantrip = spell.level === 0;
          const finalDmg = isCantrip ? 0 : Math.floor(dmgRoll.total / 2);
          result.damage = { ...dmgRoll, total: finalDmg };
          result.saved = true;
          const newHP = Math.max(0, target.currentHP - finalDmg);
          result.targetHP = newHP;
          this._log(`${target.name} saves against ${spell.name}! ${finalDmg > 0 ? `Takes ${finalDmg} damage (half).` : 'No damage.'}`);
          result.narrative = `${target.name} dodges the worst of ${caster.name}'s ${spell.name}!`;
        } else {
          // Save fail: full damage
          result.hit = true;
          result.damage = dmgRoll;
          const newHP = Math.max(0, target.currentHP - dmgRoll.total);
          result.targetHP = newHP;
          result.killed = newHP <= 0;
          this._log(`${target.name} fails save against ${spell.name}! Takes ${dmgRoll.total} ${spell.type} damage!`);
          result.narrative = `${caster.name}'s ${spell.name} engulfs ${target.name} for ${dmgRoll.total} ${spell.type} damage!`;

          if (result.killed) {
            result.narrative += ` ${target.name} is destroyed!`;
          }
        }
      }
    }

    // Non-damage utility spells
    if (!spell.damage && !spell.heal) {
      result.hit = true;
      this._log(`${caster.name} casts ${spell.name}!`);
      result.narrative = `${caster.name} casts ${spell.name}. ${spell.description}`;
      result.effect = spell.description;
    }

    return result;
  }

  // Monster AI: simple decision-making for monster turns
  // Returns an action the monster should take
  monsterAction(monster, players, grid) {
    // Find nearest alive player
    let nearest = null;
    let nearestDist = Infinity;

    for (const p of players) {
      if (p.currentHP <= 0) continue;
      const dist = Math.abs(p.x - monster.x) + Math.abs(p.y - monster.y); // Manhattan distance
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = p;
      }
    }

    if (!nearest) return { action: 'wait' };

    // If adjacent (within 1 tile), attack
    if (nearestDist <= 1) {
      // Pick first attack
      const attack = monster.attacks[0];
      return {
        action: 'attack',
        target: nearest,
        attack,
        toHitMod: attack.toHit,
      };
    }

    // If has ranged attack and within range, use it
    const rangedAttack = monster.attacks.find(a => a.range && a.range > 5);
    if (rangedAttack && nearestDist <= (rangedAttack.range / 5)) {
      return {
        action: 'attack',
        target: nearest,
        attack: rangedAttack,
        toHitMod: rangedAttack.toHit,
      };
    }

    // Otherwise, move toward nearest player
    const moveSpeed = Math.floor((monster.speed || 30) / 5); // tiles per turn
    return {
      action: 'move',
      target: nearest,
      maxTiles: moveSpeed,
    };
  }

  // Resolve a monster attack (simplified: uses attack data directly)
  resolveMonsterAttack(monster, target, attack) {
    const attackRoll = DiceRoller.rollAttack(attack.toHit);
    const result = {
      attacker: monster.name,
      target: target.name,
      weapon: attack.name,
      attackRoll,
      hit: false,
      damage: null,
    };

    if (attackRoll.critFail) {
      this._log(`${monster.name} attacks ${target.name} with ${attack.name} — MISS!`);
      result.narrative = `The ${monster.name} lunges at ${target.name} but stumbles!`;
      return result;
    }

    if (attackRoll.critical || attackRoll.total >= target.ac) {
      result.hit = true;
      const dmgRoll = DiceRoller.rollDamage(attack.damage, attackRoll.critical);
      result.damage = dmgRoll;
      const newHP = Math.max(0, target.currentHP - dmgRoll.total);
      result.targetHP = newHP;
      result.killed = newHP <= 0;

      this._log(`${monster.name} hits ${target.name} with ${attack.name} for ${dmgRoll.total} damage!`);
      result.narrative = `The ${monster.name} strikes ${target.name} with its ${attack.name} for ${dmgRoll.total} damage!`;

      if (newHP <= 0) {
        result.narrative += ` ${target.name} falls unconscious!`;
      }
    } else {
      this._log(`${monster.name} misses ${target.name} with ${attack.name}. (${attackRoll.breakdown} vs AC ${target.ac})`);
      result.narrative = `The ${monster.name} swings at ${target.name} but misses!`;
    }

    return result;
  }

  // Death saving throw for downed player
  resolveDeathSave(character) {
    const result = DiceRoller.rollDeathSave();

    if (!character.deathSaves) {
      character.deathSaves = { successes: 0, failures: 0 };
    }

    if (result.critical) {
      // Nat 20: regain 1 HP
      character.currentHP = 1;
      character.deathSaves = { successes: 0, failures: 0 };
      this._log(`${character.name} rolls a NATURAL 20 on death save! They regain consciousness with 1 HP!`);
      return { ...result, stabilized: false, regainedHP: true, character };
    }

    if (result.critFail) {
      character.deathSaves.failures += 2;
    } else if (result.success) {
      character.deathSaves.successes += 1;
    } else {
      character.deathSaves.failures += 1;
    }

    if (character.deathSaves.successes >= 3) {
      this._log(`${character.name} stabilizes! (3 death save successes)`);
      character.deathSaves = { successes: 0, failures: 0 };
      return { ...result, stabilized: true, dead: false, character };
    }

    if (character.deathSaves.failures >= 3) {
      this._log(`${character.name} has died. (3 death save failures)`);
      return { ...result, stabilized: false, dead: true, character };
    }

    this._log(`${character.name} death save: ${result.breakdown} (${character.deathSaves.successes}S / ${character.deathSaves.failures}F)`);
    return { ...result, stabilized: false, dead: false, character };
  }

  // Calculate AC for a character
  static calculateAC(character) {
    const dexMod = abilityModifier(character.abilities?.dex || 10);

    if (character.armor) {
      let ac = character.armor.ac;
      if (character.armor.addDex) {
        const maxDex = character.armor.maxDex;
        ac += maxDex !== null ? Math.min(dexMod, maxDex) : dexMod;
      }
      if (character.shield) ac += 2;
      return ac;
    }

    // Unarmored: 10 + DEX mod
    let ac = 10 + dexMod;

    // Barbarian unarmored defense: 10 + DEX + CON
    if (character.classKey === 'barbarian') {
      const conMod = abilityModifier(character.abilities?.con || 10);
      ac = 10 + dexMod + conMod;
    }

    if (character.shield) ac += 2;
    return ac;
  }

  // Calculate to-hit modifier for a weapon attack
  static calculateToHit(character, weaponKey) {
    const weapon = WEAPONS[weaponKey];
    if (!weapon) return 0;

    const level = character.level || 1;
    const prof = PROFICIENCY_BONUS[level] || 2;
    const strMod = abilityModifier(character.abilities?.str || 10);
    const dexMod = abilityModifier(character.abilities?.dex || 10);

    // Finesse weapons: use better of STR or DEX
    if (weapon.properties.includes('finesse')) {
      return Math.max(strMod, dexMod) + prof;
    }

    // Ranged weapons use DEX
    if (!weapon.melee) {
      return dexMod + prof;
    }

    // Melee weapons use STR
    return strMod + prof;
  }

  // Calculate spell modifier
  static calculateSpellMod(character) {
    const classData = character.classData;
    if (!classData?.spellcaster) return 0;

    const ability = classData.spellAbility;
    return abilityModifier(character.abilities?.[ability] || 10);
  }

  _log(message) {
    this.log.push({ time: Date.now(), message });
  }

  getLog() {
    return this.log;
  }
}

module.exports = Combat;
