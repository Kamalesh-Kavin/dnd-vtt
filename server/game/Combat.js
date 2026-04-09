// Combat.js — 5e SRD combat engine
// Handles initiative, turns, attacks, damage, death saves, and conditions

const DiceRoller = require('./DiceRoller');
const { abilityModifier, WEAPONS, SPELLS, PROFICIENCY_BONUS } = require('../data/rules');

// Narration utility
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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
      result.narrative = pick([
        `${attacker.name} swings wildly with their ${weapon.name} and completely misses — stumbling forward in an embarrassing display!`,
        `${attacker.name}'s ${weapon.name} whistles through empty air as they lose their footing. Critical miss!`,
        `The ${weapon.name} slips in ${attacker.name}'s grip, the strike going hopelessly wide! A fumble!`,
        `${attacker.name} overcommits to the swing and nearly drops their ${weapon.name}. Not their finest moment.`,
      ]);
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
        result.narrative = pick([
          `CRITICAL HIT! ${attacker.name} finds a perfect opening and drives their ${weapon.name} home with devastating force — ${damageRoll.total} damage!`,
          `${attacker.name}'s eyes lock onto a gap in ${target.name}'s defense. The ${weapon.name} strikes true with bone-crunching precision — ${damageRoll.total} damage! A critical blow!`,
          `Time seems to slow as ${attacker.name} delivers a masterful strike with their ${weapon.name}. CRITICAL! ${damageRoll.total} damage tears through ${target.name}!`,
          `The ${weapon.name} sings through the air and bites deep — a critical strike! ${attacker.name} deals a punishing ${damageRoll.total} damage to ${target.name}!`,
        ]);
      } else {
        this._log(`${attacker.name} hits ${target.name} with ${weapon.name} for ${damageRoll.total} ${weapon.type} damage. (${attackRoll.breakdown}, dmg: ${damageRoll.breakdown})`);
        result.narrative = pick([
          `${attacker.name} strikes ${target.name} with their ${weapon.name}, dealing ${damageRoll.total} ${weapon.type} damage.`,
          `${attacker.name}'s ${weapon.name} connects solidly with ${target.name} — ${damageRoll.total} damage!`,
          `A clean hit! ${attacker.name} lands their ${weapon.name} against ${target.name} for ${damageRoll.total} damage.`,
          `${attacker.name} presses the attack, catching ${target.name} with their ${weapon.name}. ${damageRoll.total} ${weapon.type} damage dealt!`,
          `Steel meets flesh as ${attacker.name}'s ${weapon.name} finds its mark — ${damageRoll.total} damage to ${target.name}!`,
        ]);
      }

      if (result.killed) {
        this._log(`${target.name} falls!`);
        result.narrative += ' ' + pick([
          `${target.name} crumples to the ground, defeated!`,
          `With a final shudder, ${target.name} collapses lifeless!`,
          `${target.name} staggers... and falls. The creature moves no more.`,
          `${target.name} lets out a dying cry and collapses in a heap!`,
        ]);
      }
    } else {
      this._log(`${attacker.name} attacks ${target.name} with ${weapon.name} — miss! (${attackRoll.breakdown} vs AC ${target.ac})`);
      result.narrative = pick([
        `${attacker.name} swings at ${target.name} with their ${weapon.name}, but the attack glances off harmlessly.`,
        `${attacker.name}'s ${weapon.name} strikes ${target.name}'s armor but fails to penetrate. A miss!`,
        `${target.name} sidesteps ${attacker.name}'s ${weapon.name} at the last moment. The blow goes wide!`,
        `The ${weapon.name} clangs against ${target.name}'s defenses — no damage dealt.`,
        `${attacker.name} lunges forward with their ${weapon.name}, but ${target.name} is too quick!`,
      ]);
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
      result.narrative = pick([
        `${caster.name} channels divine energy into ${target.name}, mending wounds with a warm golden light — ${healed} HP restored!`,
        `Radiant light flows from ${caster.name}'s hands as they cast ${spell.name}. ${target.name}'s injuries begin to close — healed for ${healed} HP!`,
        `"Be whole!" ${caster.name} intones, and ${spell.name} washes over ${target.name} like a wave of warmth. ${healed} hit points restored!`,
        `${caster.name} places a glowing hand on ${target.name}. The magic of ${spell.name} knits flesh and mends bone — ${healed} HP healed!`,
      ]);
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
          result.narrative = pick([
            `${caster.name} hurls ${spell.name} but it goes wide, fizzling against the far wall!`,
            `Arcane energy crackles from ${caster.name}'s fingertips, but the ${spell.name} misses ${target.name} entirely!`,
            `${caster.name}'s concentration falters — ${spell.name} spirals off harmlessly into the darkness!`,
          ]);
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
          result.narrative = pick([
            `${caster.name} blasts ${target.name} with ${spell.name}! ${spell.type === 'fire' ? 'Flames engulf' : spell.type === 'cold' ? 'Frost coats' : spell.type === 'radiant' ? 'Holy light sears' : 'Arcane energy strikes'} the target for ${dmgRoll.total} damage!`,
            `A bolt of ${spell.type || 'magical'} energy streaks from ${caster.name}'s outstretched hand — ${spell.name} slams into ${target.name} for ${dmgRoll.total} damage!`,
            `${caster.name}'s ${spell.name} finds its mark! ${target.name} recoils as ${dmgRoll.total} ${spell.type} damage courses through them!`,
          ]);

          if (result.killed) {
            result.narrative += ' ' + pick([
              `${target.name} is consumed by the spell's energy and destroyed!`,
              `The magic overwhelms ${target.name} — they collapse, lifeless!`,
              `${target.name} disintegrates under the force of the spell!`,
            ]);
          }
        } else {
          this._log(`${caster.name} casts ${spell.name} at ${target.name} — miss! (${attackRoll.breakdown} vs AC ${target.ac})`);
          result.narrative = pick([
            `${caster.name}'s ${spell.name} streaks past ${target.name}, missing by inches!`,
            `${target.name} ducks beneath ${caster.name}'s ${spell.name} — the spell strikes the wall behind with a crack!`,
            `The ${spell.name} sizzles through the air but ${target.name} evades the magical assault!`,
          ]);
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
          result.narrative = pick([
            `${target.name} dodges the worst of ${caster.name}'s ${spell.name}!${finalDmg > 0 ? ` Still takes ${finalDmg} damage from the residual energy.` : ' No damage taken!'}`,
            `${target.name} braces against the ${spell.name} and resists much of its power!${finalDmg > 0 ? ` ${finalDmg} damage (half).` : ''}`,
            `Quick reflexes save ${target.name} from the full force of ${spell.name}!${finalDmg > 0 ? ` But ${finalDmg} damage still gets through.` : ' The spell washes over them harmlessly.'}`,
          ]);
        } else {
          // Save fail: full damage
          result.hit = true;
          result.damage = dmgRoll;
          const newHP = Math.max(0, target.currentHP - dmgRoll.total);
          result.targetHP = newHP;
          result.killed = newHP <= 0;
          this._log(`${target.name} fails save against ${spell.name}! Takes ${dmgRoll.total} ${spell.type} damage!`);
          result.narrative = pick([
            `${caster.name}'s ${spell.name} engulfs ${target.name}! Unable to dodge, they take the full ${dmgRoll.total} ${spell.type} damage!`,
            `${target.name} fails to evade — ${spell.name} strikes with full force for ${dmgRoll.total} ${spell.type} damage!`,
            `The ${spell.name} catches ${target.name} flat-footed! ${dmgRoll.total} ${spell.type} damage tears through their defenses!`,
          ]);

          if (result.killed) {
            result.narrative += ' ' + pick([
              `${target.name} is consumed by the spell and destroyed!`,
              `The magic overwhelms ${target.name} — they fall, never to rise again!`,
              `${target.name} crumbles under the spell's fury!`,
            ]);
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
      result.narrative = pick([
        `The ${monster.name} lunges at ${target.name} but stumbles, its ${attack.name} striking nothing but air!`,
        `The ${monster.name}'s ${attack.name} goes wildly off-target — ${target.name} easily sidesteps the clumsy assault!`,
        `A desperate swing from the ${monster.name}! The ${attack.name} misses ${target.name} by a mile. What a blunder!`,
        `The ${monster.name} overextends with its ${attack.name}, leaving itself momentarily vulnerable!`,
      ]);
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

      if (attackRoll.critical) {
        result.narrative = pick([
          `CRITICAL! The ${monster.name} finds a gap in ${target.name}'s defense — its ${attack.name} strikes with terrible precision for ${dmgRoll.total} damage!`,
          `The ${monster.name}'s ${attack.name} catches ${target.name} completely off guard — a devastating ${dmgRoll.total} damage!`,
          `A ferocious critical hit! The ${monster.name}'s ${attack.name} tears into ${target.name} for ${dmgRoll.total} damage!`,
        ]);
      } else {
        result.narrative = pick([
          `The ${monster.name} strikes ${target.name} with its ${attack.name} for ${dmgRoll.total} damage!`,
          `${target.name} takes a hit from the ${monster.name}'s ${attack.name} — ${dmgRoll.total} damage!`,
          `The ${monster.name}'s ${attack.name} connects! ${target.name} grunts in pain as ${dmgRoll.total} damage lands.`,
          `With savage fury, the ${monster.name} slashes at ${target.name} with its ${attack.name}. ${dmgRoll.total} damage!`,
          `The ${monster.name} presses its attack — ${attack.name} bites into ${target.name} for ${dmgRoll.total} damage!`,
        ]);
      }

      if (newHP <= 0) {
        result.narrative += ' ' + pick([
          `${target.name} falls unconscious, bleeding on the cold stone floor!`,
          `${target.name} crumples under the blow, darkness closing in!`,
          `${target.name} collapses! The party watches in horror as their companion falls!`,
          `With a cry of pain, ${target.name} drops to the ground, barely clinging to life!`,
        ]);
      }
    } else {
      this._log(`${monster.name} misses ${target.name} with ${attack.name}. (${attackRoll.breakdown} vs AC ${target.ac})`);
      result.narrative = pick([
        `The ${monster.name} swings at ${target.name} but misses!`,
        `${target.name} deflects the ${monster.name}'s ${attack.name} at the last second!`,
        `The ${monster.name}'s ${attack.name} glances off ${target.name}'s armor harmlessly!`,
        `${target.name} ducks under the ${monster.name}'s ${attack.name} — not today!`,
        `The ${monster.name} snaps at ${target.name} with its ${attack.name}, but the blow goes wide!`,
      ]);
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
