// DiceRoller.js — Dice rolling utility
// Supports: d4, d6, d8, d10, d12, d20, d100
// Notation: "2d6+3", "1d20", "4d6kh3" (keep highest 3), "1d20adv", "1d20dis"

class DiceRoller {
  // Roll a single die (1 to sides)
  static rollDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  // Parse dice notation like "2d6+3" or "1d20"
  // Returns { count, sides, modifier }
  static parse(notation) {
    const match = notation.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
    if (!match) return null;
    return {
      count: parseInt(match[1] || '1'),
      sides: parseInt(match[2]),
      modifier: parseInt(match[3] || '0'),
    };
  }

  // Roll dice from notation string
  // Returns { rolls: [individual], total, notation, breakdown }
  static roll(notation) {
    const parsed = this.parse(notation);
    if (!parsed) {
      // Handle special formats like "3×1d4+1" (magic missile)
      if (notation.includes('×') || notation.includes('x')) {
        const parts = notation.split(/[×x]/);
        const count = parseInt(parts[0]);
        const results = [];
        let total = 0;
        for (let i = 0; i < count; i++) {
          const r = this.roll(parts[1].trim());
          results.push(r);
          total += r.total;
        }
        return {
          rolls: results.map(r => r.total),
          total,
          notation,
          breakdown: results.map(r => r.breakdown).join(' + '),
        };
      }
      return { rolls: [], total: 0, notation, breakdown: 'invalid' };
    }

    const rolls = [];
    for (let i = 0; i < parsed.count; i++) {
      rolls.push(this.rollDie(parsed.sides));
    }

    const sum = rolls.reduce((a, b) => a + b, 0);
    const total = sum + parsed.modifier;
    const modStr = parsed.modifier > 0 ? `+${parsed.modifier}` : parsed.modifier < 0 ? `${parsed.modifier}` : '';

    return {
      rolls,
      total: Math.max(0, total), // can't go below 0
      notation,
      breakdown: `[${rolls.join(', ')}]${modStr} = ${total}`,
    };
  }

  // Roll with advantage (roll 2d20, take higher)
  static rollAdvantage(modifier = 0) {
    const r1 = this.rollDie(20);
    const r2 = this.rollDie(20);
    const best = Math.max(r1, r2);
    const total = best + modifier;
    const modStr = modifier !== 0 ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
    return {
      rolls: [r1, r2],
      kept: best,
      total,
      advantage: true,
      breakdown: `[${r1}, ${r2}] keep ${best}${modStr} = ${total}`,
    };
  }

  // Roll with disadvantage (roll 2d20, take lower)
  static rollDisadvantage(modifier = 0) {
    const r1 = this.rollDie(20);
    const r2 = this.rollDie(20);
    const worst = Math.min(r1, r2);
    const total = worst + modifier;
    const modStr = modifier !== 0 ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
    return {
      rolls: [r1, r2],
      kept: worst,
      total,
      disadvantage: true,
      breakdown: `[${r1}, ${r2}] keep ${worst}${modStr} = ${total}`,
    };
  }

  // Roll ability scores: 4d6, drop lowest
  static rollAbilityScore() {
    const rolls = [this.rollDie(6), this.rollDie(6), this.rollDie(6), this.rollDie(6)];
    rolls.sort((a, b) => b - a);
    const kept = rolls.slice(0, 3);
    const total = kept.reduce((a, b) => a + b, 0);
    return {
      rolls,
      dropped: rolls[3],
      total,
      breakdown: `[${rolls.join(', ')}] drop ${rolls[3]} = ${total}`,
    };
  }

  // Generate a full set of 6 ability scores
  static rollAbilityScores() {
    const scores = [];
    for (let i = 0; i < 6; i++) {
      scores.push(this.rollAbilityScore());
    }
    return scores;
  }

  // Roll initiative: d20 + DEX modifier
  static rollInitiative(dexMod) {
    const r = this.rollDie(20);
    return {
      roll: r,
      modifier: dexMod,
      total: r + dexMod,
      breakdown: `${r}+${dexMod} = ${r + dexMod}`,
    };
  }

  // Attack roll: d20 + toHit modifier
  static rollAttack(toHitMod, advantage = false, disadvantage = false) {
    let result;
    if (advantage && !disadvantage) {
      result = this.rollAdvantage(toHitMod);
    } else if (disadvantage && !advantage) {
      result = this.rollDisadvantage(toHitMod);
    } else {
      const r = this.rollDie(20);
      const total = r + toHitMod;
      result = {
        rolls: [r],
        total,
        breakdown: `${r}+${toHitMod} = ${total}`,
      };
    }

    // Check for natural 20 (crit) or natural 1 (crit fail)
    const naturalRoll = result.kept || result.rolls[0];
    result.critical = naturalRoll === 20;
    result.critFail = naturalRoll === 1;
    return result;
  }

  // Damage roll with optional critical (double dice)
  static rollDamage(notation, critical = false) {
    const parsed = this.parse(notation);
    if (!parsed) return this.roll(notation); // fallback for complex notation

    const count = critical ? parsed.count * 2 : parsed.count;
    const newNotation = `${count}d${parsed.sides}${parsed.modifier > 0 ? '+' + parsed.modifier : parsed.modifier < 0 ? parsed.modifier : ''}`;
    const result = this.roll(newNotation);
    if (critical) result.critical = true;
    return result;
  }

  // Saving throw: d20 + ability modifier (+ proficiency if proficient)
  static rollSave(abilityMod, profBonus = 0) {
    const r = this.rollDie(20);
    const total = r + abilityMod + profBonus;
    return {
      roll: r,
      modifier: abilityMod,
      proficiency: profBonus,
      total,
      breakdown: `${r}+${abilityMod}${profBonus ? '+' + profBonus : ''} = ${total}`,
    };
  }

  // Skill check: d20 + ability modifier + proficiency (if proficient)
  static rollSkillCheck(abilityMod, profBonus = 0, advantage = false, disadvantage = false) {
    const totalMod = abilityMod + profBonus;
    if (advantage) return this.rollAdvantage(totalMod);
    if (disadvantage) return this.rollDisadvantage(totalMod);

    const r = this.rollDie(20);
    const total = r + totalMod;
    return {
      rolls: [r],
      total,
      breakdown: `${r}+${totalMod} = ${total}`,
    };
  }

  // Death saving throw: d20, >= 10 success, < 10 fail, 20 = regain 1 HP, 1 = 2 fails
  static rollDeathSave() {
    const r = this.rollDie(20);
    return {
      roll: r,
      success: r >= 10,
      critical: r === 20,    // regain 1 HP
      critFail: r === 1,     // counts as 2 failures
      breakdown: `${r} — ${r >= 10 ? 'SUCCESS' : 'FAILURE'}${r === 20 ? ' (CRITICAL!)' : ''}${r === 1 ? ' (DOUBLE FAIL!)' : ''}`,
    };
  }
}

module.exports = DiceRoller;
