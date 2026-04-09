// 5e SRD — Races, Classes, Abilities, Spells, Monsters
// Simplified but faithful to core mechanics

// =====================
// ABILITY SCORES
// =====================
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

// =====================
// RACES
// =====================
const RACES = {
  human: {
    name: 'Human',
    description: 'Versatile and ambitious, humans are the most common folk.',
    speed: 30,
    bonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    traits: ['Extra Language'],
    hp_bonus: 0,
    icon: '🧑',
  },
  elf: {
    name: 'Elf',
    description: 'Graceful and long-lived, with keen senses and a love of nature.',
    speed: 30,
    bonuses: { dex: 2 },
    traits: ['Darkvision (60ft)', 'Fey Ancestry', 'Trance'],
    hp_bonus: 0,
    icon: '🧝',
  },
  dwarf: {
    name: 'Dwarf',
    description: 'Bold and hardy, dwarves are known for their skill in warfare and crafting.',
    speed: 25,
    bonuses: { con: 2 },
    traits: ['Darkvision (60ft)', 'Dwarven Resilience', 'Stonecunning'],
    hp_bonus: 1, // per level
    icon: '⛏️',
  },
  halfling: {
    name: 'Halfling',
    description: 'Small and nimble, halflings survive in a world of larger creatures.',
    speed: 25,
    bonuses: { dex: 2 },
    traits: ['Lucky (reroll 1s)', 'Brave', 'Halfling Nimbleness'],
    hp_bonus: 0,
    icon: '🍀',
  },
  dragonborn: {
    name: 'Dragonborn',
    description: 'Born of dragons, they walk proudly with draconic power.',
    speed: 30,
    bonuses: { str: 2, cha: 1 },
    traits: ['Breath Weapon (2d6)', 'Damage Resistance'],
    hp_bonus: 0,
    icon: '🐉',
  },
  tiefling: {
    name: 'Tiefling',
    description: 'Bearing the mark of an infernal bloodline, tieflings face distrust.',
    speed: 30,
    bonuses: { cha: 2, int: 1 },
    traits: ['Darkvision (60ft)', 'Hellish Resistance (fire)', 'Infernal Legacy'],
    hp_bonus: 0,
    icon: '😈',
  },
  halfelf: {
    name: 'Half-Elf',
    description: 'Walking in two worlds, half-elves combine human drive with elven grace.',
    speed: 30,
    bonuses: { cha: 2 }, // +1 to two others chosen at creation
    traits: ['Darkvision (60ft)', 'Fey Ancestry', 'Skill Versatility'],
    hp_bonus: 0,
    icon: '🌿',
  },
  orc: {
    name: 'Half-Orc',
    description: 'Fierce and enduring, half-orcs combine orcish might with human cunning.',
    speed: 30,
    bonuses: { str: 2, con: 1 },
    traits: ['Darkvision (60ft)', 'Relentless Endurance', 'Savage Attacks'],
    hp_bonus: 0,
    icon: '💪',
  },
};

// =====================
// CLASSES
// =====================
const CLASSES = {
  fighter: {
    name: 'Fighter',
    description: 'Masters of martial combat, skilled with weapons and armor.',
    hitDie: 10,
    primaryAbility: 'str',
    savingThrows: ['str', 'con'],
    armorProf: ['light', 'medium', 'heavy', 'shields'],
    weaponProf: ['simple', 'martial'],
    startingHP: 10,
    skills: ['Athletics', 'Acrobatics', 'Intimidation', 'Perception', 'Survival'],
    features: {
      1: ['Second Wind (heal 1d10+level, 1/rest)', 'Fighting Style'],
      2: ['Action Surge (extra action, 1/rest)'],
    },
    spellcaster: false,
    icon: '⚔️',
  },
  wizard: {
    name: 'Wizard',
    description: 'Scholarly magic-users who bend reality through arcane study.',
    hitDie: 6,
    primaryAbility: 'int',
    savingThrows: ['int', 'wis'],
    armorProf: [],
    weaponProf: ['simple'],
    startingHP: 6,
    skills: ['Arcana', 'History', 'Investigation', 'Medicine', 'Religion'],
    features: {
      1: ['Arcane Recovery (recover spell slots on short rest)'],
    },
    spellcaster: true,
    spellAbility: 'int',
    cantripsKnown: 3,
    spellSlots: { 1: 2 },
    icon: '🧙',
  },
  rogue: {
    name: 'Rogue',
    description: 'Skilled tricksters who use stealth and cunning to overcome obstacles.',
    hitDie: 8,
    primaryAbility: 'dex',
    savingThrows: ['dex', 'int'],
    armorProf: ['light'],
    weaponProf: ['simple', 'hand crossbow', 'longsword', 'rapier', 'shortsword'],
    startingHP: 8,
    skills: ['Stealth', 'Acrobatics', 'Deception', 'Perception', 'Sleight of Hand', 'Investigation'],
    features: {
      1: ['Sneak Attack (1d6 extra damage)', 'Expertise (double proficiency)', "Thieves' Cant"],
      2: ['Cunning Action (Dash/Disengage/Hide as bonus)'],
    },
    spellcaster: false,
    icon: '🗡️',
  },
  cleric: {
    name: 'Cleric',
    description: 'Divine agents who wield the power of their gods to heal and smite.',
    hitDie: 8,
    primaryAbility: 'wis',
    savingThrows: ['wis', 'cha'],
    armorProf: ['light', 'medium', 'shields'],
    weaponProf: ['simple'],
    startingHP: 8,
    skills: ['Medicine', 'Religion', 'Insight', 'History', 'Persuasion'],
    features: {
      1: ['Divine Domain', 'Channel Divinity (1/rest)'],
    },
    spellcaster: true,
    spellAbility: 'wis',
    cantripsKnown: 3,
    spellSlots: { 1: 2 },
    icon: '⛪',
  },
  ranger: {
    name: 'Ranger',
    description: 'Warriors of the wilderness who hunt the monsters that threaten civilization.',
    hitDie: 10,
    primaryAbility: 'dex',
    savingThrows: ['str', 'dex'],
    armorProf: ['light', 'medium', 'shields'],
    weaponProf: ['simple', 'martial'],
    startingHP: 10,
    skills: ['Animal Handling', 'Athletics', 'Nature', 'Perception', 'Stealth', 'Survival'],
    features: {
      1: ['Favored Enemy', 'Natural Explorer'],
      2: ['Fighting Style', 'Spellcasting'],
    },
    spellcaster: false, // starts at level 2
    icon: '🏹',
  },
  barbarian: {
    name: 'Barbarian',
    description: 'Fierce warriors driven by a primal fury that fuels devastating attacks.',
    hitDie: 12,
    primaryAbility: 'str',
    savingThrows: ['str', 'con'],
    armorProf: ['light', 'medium', 'shields'],
    weaponProf: ['simple', 'martial'],
    startingHP: 12,
    skills: ['Athletics', 'Intimidation', 'Nature', 'Perception', 'Survival', 'Animal Handling'],
    features: {
      1: ['Rage (bonus damage, resistance, 2/day)', 'Unarmored Defense (AC = 10+DEX+CON)'],
    },
    spellcaster: false,
    icon: '🪓',
  },
  bard: {
    name: 'Bard',
    description: 'Inspiring magicians whose power echoes the music of creation.',
    hitDie: 8,
    primaryAbility: 'cha',
    savingThrows: ['dex', 'cha'],
    armorProf: ['light'],
    weaponProf: ['simple', 'hand crossbow', 'longsword', 'rapier', 'shortsword'],
    startingHP: 8,
    skills: ['Performance', 'Persuasion', 'Deception', 'Acrobatics', 'Arcana', 'History'],
    features: {
      1: ['Bardic Inspiration (d6, CHA mod/day)', 'Spellcasting'],
    },
    spellcaster: true,
    spellAbility: 'cha',
    cantripsKnown: 2,
    spellSlots: { 1: 2 },
    icon: '🎵',
  },
  paladin: {
    name: 'Paladin',
    description: 'Holy warriors bound by a sacred oath to fight evil and protect the weak.',
    hitDie: 10,
    primaryAbility: 'str',
    savingThrows: ['wis', 'cha'],
    armorProf: ['light', 'medium', 'heavy', 'shields'],
    weaponProf: ['simple', 'martial'],
    startingHP: 10,
    skills: ['Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion'],
    features: {
      1: ['Divine Sense', 'Lay on Hands (heal pool = 5×level)'],
      2: ['Fighting Style', 'Spellcasting', 'Divine Smite (2d8 radiant)'],
    },
    spellcaster: false, // starts at level 2
    icon: '🛡️',
  },
};

// =====================
// WEAPONS
// =====================
const WEAPONS = {
  // Simple melee
  dagger:       { name: 'Dagger',       damage: '1d4',  type: 'piercing',  category: 'simple', melee: true,  range: 20, properties: ['finesse', 'light', 'thrown'] },
  handaxe:      { name: 'Handaxe',      damage: '1d6',  type: 'slashing',  category: 'simple', melee: true,  range: 20, properties: ['light', 'thrown'] },
  mace:         { name: 'Mace',         damage: '1d6',  type: 'bludgeoning', category: 'simple', melee: true,  range: 0, properties: [] },
  quarterstaff: { name: 'Quarterstaff', damage: '1d6',  type: 'bludgeoning', category: 'simple', melee: true,  range: 0, properties: ['versatile (1d8)'] },
  // Simple ranged
  shortbow:     { name: 'Shortbow',     damage: '1d6',  type: 'piercing',  category: 'simple', melee: false, range: 80, properties: ['ammunition', 'two-handed'] },
  light_crossbow: { name: 'Light Crossbow', damage: '1d8', type: 'piercing', category: 'simple', melee: false, range: 80, properties: ['ammunition', 'loading', 'two-handed'] },
  // Martial melee
  longsword:    { name: 'Longsword',    damage: '1d8',  type: 'slashing',  category: 'martial', melee: true,  range: 0, properties: ['versatile (1d10)'] },
  greatsword:   { name: 'Greatsword',   damage: '2d6',  type: 'slashing',  category: 'martial', melee: true,  range: 0, properties: ['heavy', 'two-handed'] },
  rapier:       { name: 'Rapier',       damage: '1d8',  type: 'piercing',  category: 'martial', melee: true,  range: 0, properties: ['finesse'] },
  battleaxe:    { name: 'Battleaxe',    damage: '1d8',  type: 'slashing',  category: 'martial', melee: true,  range: 0, properties: ['versatile (1d10)'] },
  warhammer:    { name: 'Warhammer',    damage: '1d8',  type: 'bludgeoning', category: 'martial', melee: true,  range: 0, properties: ['versatile (1d10)'] },
  // Martial ranged
  longbow:      { name: 'Longbow',      damage: '1d8',  type: 'piercing',  category: 'martial', melee: false, range: 150, properties: ['ammunition', 'heavy', 'two-handed'] },
};

// =====================
// ARMOR
// =====================
const ARMOR = {
  // Light
  leather:    { name: 'Leather Armor',    ac: 11, addDex: true, maxDex: null, category: 'light',  stealthDisadv: false },
  studded:    { name: 'Studded Leather',   ac: 12, addDex: true, maxDex: null, category: 'light',  stealthDisadv: false },
  // Medium
  hide:       { name: 'Hide Armor',        ac: 12, addDex: true, maxDex: 2,    category: 'medium', stealthDisadv: false },
  chain_shirt:{ name: 'Chain Shirt',       ac: 13, addDex: true, maxDex: 2,    category: 'medium', stealthDisadv: false },
  scale_mail: { name: 'Scale Mail',        ac: 14, addDex: true, maxDex: 2,    category: 'medium', stealthDisadv: true },
  breastplate:{ name: 'Breastplate',       ac: 14, addDex: true, maxDex: 2,    category: 'medium', stealthDisadv: false },
  // Heavy
  chain_mail: { name: 'Chain Mail',        ac: 16, addDex: false, maxDex: 0,   category: 'heavy',  stealthDisadv: true },
  plate:      { name: 'Plate Armor',       ac: 18, addDex: false, maxDex: 0,   category: 'heavy',  stealthDisadv: true },
  // Shield
  shield:     { name: 'Shield',            ac: 2,  addDex: false, maxDex: 0,   category: 'shield', stealthDisadv: false },
};

// =====================
// SPELLS (Level 0 = Cantrips, Level 1)
// =====================
const SPELLS = {
  // Cantrips
  fire_bolt:      { name: 'Fire Bolt',      level: 0, school: 'evocation',    damage: '1d10', type: 'fire',    range: 120, classes: ['wizard'], description: 'Hurl a mote of fire at a creature. Ranged spell attack.' },
  sacred_flame:   { name: 'Sacred Flame',   level: 0, school: 'evocation',    damage: '1d8',  type: 'radiant', range: 60,  classes: ['cleric'], description: 'Flame descends on a creature. DEX save or take damage.' },
  chill_touch:    { name: 'Chill Touch',    level: 0, school: 'necromancy',  damage: '1d8',  type: 'necrotic', range: 120, classes: ['bard'], description: 'A ghostly skeletal hand strikes a creature. Ranged spell attack.' },
  light:          { name: 'Light',          level: 0, school: 'evocation',    damage: null,   type: null,      range: 0,   classes: ['wizard', 'cleric', 'bard'], description: 'Touch an object — it sheds bright light in 20ft radius.' },
  mending:        { name: 'Mending',        level: 0, school: 'transmutation', damage: null,  type: null,      range: 0,   classes: ['wizard', 'cleric', 'bard'], description: 'Repair a single break or tear in an object.' },
  minor_illusion: { name: 'Minor Illusion', level: 0, school: 'illusion',     damage: null,   type: null,      range: 30,  classes: ['wizard', 'bard'], description: 'Create a sound or an image of an object within range.' },
  vicious_mockery: { name: 'Vicious Mockery', level: 0, school: 'enchantment', damage: '1d4', type: 'psychic', range: 60, classes: ['bard'], description: 'Unleash a string of insults laced with subtle enchantment.' },

  // Level 1
  magic_missile:  { name: 'Magic Missile',  level: 1, school: 'evocation',    damage: '3×1d4+1', type: 'force', range: 120, classes: ['wizard'], description: 'Three glowing darts of magical force. Auto-hit.' },
  cure_wounds:    { name: 'Cure Wounds',    level: 1, school: 'evocation',    damage: null,   type: null,      range: 0,   classes: ['cleric', 'bard', 'ranger', 'paladin'], heal: '1d8+mod', description: 'Touch a creature to restore hit points.' },
  shield_spell:   { name: 'Shield',         level: 1, school: 'abjuration',   damage: null,   type: null,      range: 0,   classes: ['wizard'], description: 'Reaction: +5 AC until your next turn.' },
  thunderwave:    { name: 'Thunderwave',    level: 1, school: 'evocation',    damage: '2d8',  type: 'thunder', range: 15,  classes: ['wizard', 'bard'], description: 'Wave of thunderous force. Creatures pushed 10ft.' },
  healing_word:   { name: 'Healing Word',   level: 1, school: 'evocation',    damage: null,   type: null,      range: 60,  classes: ['cleric', 'bard'], heal: '1d4+mod', description: 'Bonus action: heal a creature you can see within range.' },
  bless:          { name: 'Bless',          level: 1, school: 'enchantment',  damage: null,   type: null,      range: 30,  classes: ['cleric', 'paladin'], description: 'Up to 3 creatures add 1d4 to attacks and saves.' },
  guiding_bolt:   { name: 'Guiding Bolt',   level: 1, school: 'evocation',    damage: '4d6',  type: 'radiant', range: 120, classes: ['cleric'], description: 'Flash of light. Next attack on target has advantage.' },
  burning_hands:  { name: 'Burning Hands',  level: 1, school: 'evocation',    damage: '3d6',  type: 'fire',    range: 15,  classes: ['wizard'], description: '15ft cone of fire. DEX save for half.' },
  sleep:          { name: 'Sleep',          level: 1, school: 'enchantment',  damage: null,   type: null,      range: 90,  classes: ['wizard', 'bard'], description: 'Put 5d8 HP worth of creatures to sleep.' },
  detect_magic:   { name: 'Detect Magic',   level: 1, school: 'divination',   damage: null,   type: null,      range: 30,  classes: ['wizard', 'cleric', 'bard', 'ranger', 'paladin'], description: 'Sense magic within 30ft for 10 minutes.' },
};

// =====================
// MONSTERS
// =====================
const MONSTERS = {
  // CR 1/8
  kobold: {
    name: 'Kobold', cr: 0.125, hp: 5, ac: 12, speed: 30,
    str: 7, dex: 15, con: 9, int: 8, wis: 7, cha: 8,
    attacks: [{ name: 'Dagger', toHit: 4, damage: '1d4+2', type: 'piercing' }],
    xp: 25, icon: '🦎', size: 'small',
    traits: ['Pack Tactics (advantage when ally adjacent)', 'Sunlight Sensitivity'],
  },
  // CR 1/4
  goblin: {
    name: 'Goblin', cr: 0.25, hp: 7, ac: 15, speed: 30,
    str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8,
    attacks: [{ name: 'Scimitar', toHit: 4, damage: '1d6+2', type: 'slashing' }],
    xp: 50, icon: '👺', size: 'small',
    traits: ['Nimble Escape (Disengage/Hide as bonus action)'],
  },
  skeleton: {
    name: 'Skeleton', cr: 0.25, hp: 13, ac: 13, speed: 30,
    str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5,
    attacks: [{ name: 'Shortsword', toHit: 4, damage: '1d6+2', type: 'piercing' }],
    xp: 50, icon: '💀', size: 'medium',
    traits: ['Vulnerable to bludgeoning', 'Immune to poison'],
  },
  // CR 1/2
  orc_warrior: {
    name: 'Orc', cr: 0.5, hp: 15, ac: 13, speed: 30,
    str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10,
    attacks: [{ name: 'Greataxe', toHit: 5, damage: '1d12+3', type: 'slashing' }],
    xp: 100, icon: '👹', size: 'medium',
    traits: ['Aggressive (bonus action: move toward enemy)'],
  },
  // CR 1
  bugbear: {
    name: 'Bugbear', cr: 1, hp: 27, ac: 16, speed: 30,
    str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9,
    attacks: [{ name: 'Morningstar', toHit: 4, damage: '2d8+2', type: 'piercing' }],
    xp: 200, icon: '🐻', size: 'medium',
    traits: ['Surprise Attack (+2d6 damage if target surprised)', 'Brute'],
  },
  dire_wolf: {
    name: 'Dire Wolf', cr: 1, hp: 37, ac: 14, speed: 50,
    str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7,
    attacks: [{ name: 'Bite', toHit: 5, damage: '2d6+3', type: 'piercing' }],
    xp: 200, icon: '🐺', size: 'large',
    traits: ['Pack Tactics', 'Keen Hearing and Smell'],
  },
  // CR 2
  ogre: {
    name: 'Ogre', cr: 2, hp: 59, ac: 11, speed: 40,
    str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7,
    attacks: [{ name: 'Greatclub', toHit: 6, damage: '2d8+4', type: 'bludgeoning' }],
    xp: 450, icon: '🗿', size: 'large',
    traits: [],
  },
  // CR 5
  troll: {
    name: 'Troll', cr: 5, hp: 84, ac: 15, speed: 30,
    str: 18, dex: 13, con: 20, int: 7, wis: 9, cha: 7,
    attacks: [
      { name: 'Bite', toHit: 7, damage: '1d6+4', type: 'piercing' },
      { name: 'Claw', toHit: 7, damage: '2d6+4', type: 'slashing' },
    ],
    xp: 1800, icon: '🧌', size: 'large',
    traits: ['Regeneration (10 HP/turn unless fire/acid)', 'Multiattack (bite + 2 claws)'],
  },
  // Boss
  young_dragon: {
    name: 'Young Red Dragon', cr: 10, hp: 178, ac: 18, speed: 40,
    str: 23, dex: 10, con: 21, int: 14, wis: 11, cha: 19,
    attacks: [
      { name: 'Bite', toHit: 10, damage: '2d10+6', type: 'piercing' },
      { name: 'Claw', toHit: 10, damage: '2d6+6', type: 'slashing' },
    ],
    xp: 5900, icon: '🐲', size: 'large',
    traits: ['Fire Breath (12d6 fire, 30ft cone, recharge 5-6)', 'Multiattack', 'Frightful Presence'],
  },
};

// =====================
// DUNGEON TILES
// =====================
const TILE_TYPES = {
  VOID:     0,  // unexplored / nothing
  FLOOR:    1,  // walkable floor
  WALL:     2,  // solid wall
  DOOR:     3,  // door (walkable, blocks LoS until opened)
  STAIRS:   4,  // stairs to next level
  TRAP:     5,  // hidden trap
  CHEST:    6,  // treasure chest
  WATER:    7,  // shallow water (difficult terrain)
  PIT:      8,  // pit (fall damage)
};

const TILE_NAMES = {
  0: 'Void',
  1: 'Floor',
  2: 'Wall',
  3: 'Door',
  4: 'Stairs',
  5: 'Trap',
  6: 'Chest',
  7: 'Water',
  8: 'Pit',
};

// Standard 5e skill list
const SKILLS = {
  acrobatics:      { ability: 'dex', name: 'Acrobatics' },
  animal_handling: { ability: 'wis', name: 'Animal Handling' },
  arcana:          { ability: 'int', name: 'Arcana' },
  athletics:       { ability: 'str', name: 'Athletics' },
  deception:       { ability: 'cha', name: 'Deception' },
  history:         { ability: 'int', name: 'History' },
  insight:         { ability: 'wis', name: 'Insight' },
  intimidation:    { ability: 'cha', name: 'Intimidation' },
  investigation:   { ability: 'int', name: 'Investigation' },
  medicine:        { ability: 'wis', name: 'Medicine' },
  nature:          { ability: 'int', name: 'Nature' },
  perception:      { ability: 'wis', name: 'Perception' },
  performance:     { ability: 'cha', name: 'Performance' },
  persuasion:      { ability: 'cha', name: 'Persuasion' },
  religion:        { ability: 'int', name: 'Religion' },
  sleight_of_hand: { ability: 'dex', name: 'Sleight of Hand' },
  stealth:         { ability: 'dex', name: 'Stealth' },
  survival:        { ability: 'wis', name: 'Survival' },
};

// Proficiency bonus by level
const PROFICIENCY_BONUS = {
  1: 2, 2: 2, 3: 2, 4: 2, 5: 3, 6: 3, 7: 3, 8: 3,
  9: 4, 10: 4, 11: 4, 12: 4, 13: 5, 14: 5, 15: 5, 16: 5,
  17: 6, 18: 6, 19: 6, 20: 6,
};

module.exports = {
  ABILITIES,
  abilityModifier,
  RACES,
  CLASSES,
  WEAPONS,
  ARMOR,
  SPELLS,
  MONSTERS,
  TILE_TYPES,
  TILE_NAMES,
  SKILLS,
  PROFICIENCY_BONUS,
};
