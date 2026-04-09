// DungeonGenerator.js — Procedural dungeon generation for AI DM mode
// Generates grid-based dungeons with rooms, corridors, doors, traps, chests, and stairs

const { TILE_TYPES, MONSTERS } = require('../data/rules');

class DungeonGenerator {
  // Generate a complete dungeon level
  // Returns { grid[][], rooms[], spawnPoints[], monsterPlacements[], startPos }
  static generate(width = 50, height = 50, options = {}) {
    const {
      roomCount = 8,
      minRoomSize = 4,
      maxRoomSize = 10,
      monsterDensity = 0.5,  // 0-1, how populated
      trapChance = 0.15,
      chestChance = 0.1,
      difficulty = 1,         // 1-5, affects monster CR
    } = options;

    // Initialize grid with walls
    const grid = [];
    for (let y = 0; y < height; y++) {
      grid[y] = new Array(width).fill(TILE_TYPES.WALL);
    }

    // Generate rooms
    const rooms = this._generateRooms(width, height, roomCount, minRoomSize, maxRoomSize);

    // Carve rooms into grid
    for (const room of rooms) {
      this._carveRoom(grid, room);
    }

    // Connect rooms with corridors
    this._connectRooms(grid, rooms);

    // Place doors at room entrances
    this._placeDoors(grid, rooms);

    // Place traps on floor tiles
    this._placeTraps(grid, rooms, trapChance);

    // Place chests in rooms
    this._placeChests(grid, rooms, chestChance);

    // Place stairs in the last room
    const stairsRoom = rooms[rooms.length - 1];
    const stairsPos = this._roomCenter(stairsRoom);
    grid[stairsPos.y][stairsPos.x] = TILE_TYPES.STAIRS;

    // Place monsters
    const monsterPlacements = this._placeMonsters(grid, rooms, monsterDensity, difficulty);

    // Start position: center of first room
    const startPos = this._roomCenter(rooms[0]);

    // Generate fog of war (all hidden initially)
    const fog = [];
    for (let y = 0; y < height; y++) {
      fog[y] = new Array(width).fill(false);
    }

    return {
      width,
      height,
      grid,
      fog,
      rooms,
      monsterPlacements,
      startPos,
      stairsPos,
    };
  }

  // Generate non-overlapping rooms
  static _generateRooms(mapW, mapH, count, minSize, maxSize) {
    const rooms = [];
    let attempts = 0;
    const maxAttempts = count * 50;

    while (rooms.length < count && attempts < maxAttempts) {
      attempts++;
      const w = this._randRange(minSize, maxSize);
      const h = this._randRange(minSize, maxSize);
      const x = this._randRange(1, mapW - w - 2);
      const y = this._randRange(1, mapH - h - 2);
      const room = { x, y, w, h, id: rooms.length };

      // Check overlap with existing rooms (with 1-tile buffer)
      let overlap = false;
      for (const other of rooms) {
        if (
          room.x - 1 < other.x + other.w + 1 &&
          room.x + room.w + 1 > other.x - 1 &&
          room.y - 1 < other.y + other.h + 1 &&
          room.y + room.h + 1 > other.y - 1
        ) {
          overlap = true;
          break;
        }
      }

      if (!overlap) {
        rooms.push(room);
      }
    }

    return rooms;
  }

  // Carve a room into the grid (set tiles to FLOOR)
  static _carveRoom(grid, room) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        grid[y][x] = TILE_TYPES.FLOOR;
      }
    }
  }

  // Connect rooms with L-shaped corridors
  static _connectRooms(grid, rooms) {
    for (let i = 1; i < rooms.length; i++) {
      const a = this._roomCenter(rooms[i - 1]);
      const b = this._roomCenter(rooms[i]);

      // Randomly go horizontal-first or vertical-first
      if (Math.random() < 0.5) {
        this._carveHorizontal(grid, a.x, b.x, a.y);
        this._carveVertical(grid, a.y, b.y, b.x);
      } else {
        this._carveVertical(grid, a.y, b.y, a.x);
        this._carveHorizontal(grid, a.x, b.x, b.y);
      }
    }

    // Add a few extra connections for loops (more interesting navigation)
    if (rooms.length > 4) {
      const extraConnections = Math.floor(rooms.length / 4);
      for (let i = 0; i < extraConnections; i++) {
        const a = rooms[this._randRange(0, rooms.length - 1)];
        const b = rooms[this._randRange(0, rooms.length - 1)];
        if (a.id !== b.id) {
          const ca = this._roomCenter(a);
          const cb = this._roomCenter(b);
          this._carveHorizontal(grid, ca.x, cb.x, ca.y);
          this._carveVertical(grid, ca.y, cb.y, cb.x);
        }
      }
    }
  }

  static _carveHorizontal(grid, x1, x2, y) {
    const start = Math.min(x1, x2);
    const end = Math.max(x1, x2);
    for (let x = start; x <= end; x++) {
      if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) {
        if (grid[y][x] === TILE_TYPES.WALL) {
          grid[y][x] = TILE_TYPES.FLOOR;
        }
      }
    }
  }

  static _carveVertical(grid, y1, y2, x) {
    const start = Math.min(y1, y2);
    const end = Math.max(y1, y2);
    for (let y = start; y <= end; y++) {
      if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) {
        if (grid[y][x] === TILE_TYPES.WALL) {
          grid[y][x] = TILE_TYPES.FLOOR;
        }
      }
    }
  }

  // Place doors where corridors meet room edges
  static _placeDoors(grid, rooms) {
    for (const room of rooms) {
      // Check perimeter of each room
      for (let x = room.x; x < room.x + room.w; x++) {
        this._tryPlaceDoor(grid, x, room.y - 1, x, room.y);
        this._tryPlaceDoor(grid, x, room.y + room.h, x, room.y + room.h - 1);
      }
      for (let y = room.y; y < room.y + room.h; y++) {
        this._tryPlaceDoor(grid, room.x - 1, y, room.x, y);
        this._tryPlaceDoor(grid, room.x + room.w, y, room.x + room.w - 1, y);
      }
    }
  }

  static _tryPlaceDoor(grid, ox, oy, ix, iy) {
    if (oy < 0 || oy >= grid.length || ox < 0 || ox >= grid[0].length) return;
    // If outside is corridor floor and inside is room floor, place door
    if (grid[oy][ox] === TILE_TYPES.FLOOR && grid[iy][ix] === TILE_TYPES.FLOOR) {
      // Only place door if it's on the wall boundary (check that it was a wall transition)
      // We place doors at ~30% chance to avoid too many
      if (Math.random() < 0.3) {
        grid[oy][ox] = TILE_TYPES.DOOR;
      }
    }
  }

  // Place traps on random floor tiles (not in first room)
  static _placeTraps(grid, rooms, chance) {
    for (let i = 1; i < rooms.length; i++) {
      const room = rooms[i];
      const floorTiles = this._getFloorTiles(grid, room);
      for (const tile of floorTiles) {
        if (Math.random() < chance / rooms.length) {
          grid[tile.y][tile.x] = TILE_TYPES.TRAP;
        }
      }
    }
  }

  // Place chests in rooms (not first room)
  static _placeChests(grid, rooms, chance) {
    for (let i = 1; i < rooms.length; i++) {
      if (Math.random() < chance * 2) {
        const room = rooms[i];
        const floorTiles = this._getFloorTiles(grid, room);
        if (floorTiles.length > 0) {
          const tile = floorTiles[Math.floor(Math.random() * floorTiles.length)];
          grid[tile.y][tile.x] = TILE_TYPES.CHEST;
        }
      }
    }
  }

  // Place monsters in rooms (not first room)
  static _placeMonsters(grid, rooms, density, difficulty) {
    const placements = [];

    // Build CR range based on difficulty
    const crRanges = {
      1: [0.125, 0.5],   // Easy
      2: [0.25, 1],      // Medium
      3: [0.5, 2],       // Hard
      4: [1, 5],         // Very hard
      5: [2, 10],        // Deadly
    };
    const [minCR, maxCR] = crRanges[Math.min(difficulty, 5)] || crRanges[1];

    // Get eligible monsters
    const eligible = Object.entries(MONSTERS).filter(
      ([, m]) => m.cr >= minCR && m.cr <= maxCR
    );

    if (eligible.length === 0) return placements;

    // Skip the first room (player spawn) and optionally last (stairs/boss)
    for (let i = 1; i < rooms.length; i++) {
      const room = rooms[i];
      const isLastRoom = i === rooms.length - 1;

      // More monsters in bigger rooms
      const roomArea = room.w * room.h;
      const maxMonsters = Math.max(1, Math.floor(roomArea * density / 10));
      const monsterCount = this._randRange(1, maxMonsters);

      const floorTiles = this._getFloorTiles(grid, room);
      if (floorTiles.length === 0) continue;

      for (let m = 0; m < monsterCount && floorTiles.length > 0; m++) {
        const tileIdx = Math.floor(Math.random() * floorTiles.length);
        const tile = floorTiles.splice(tileIdx, 1)[0];

        // Pick a monster — last room gets tougher ones
        let monster;
        if (isLastRoom && difficulty >= 2) {
          // Boss room: pick highest CR available
          const sorted = [...eligible].sort((a, b) => b[1].cr - a[1].cr);
          monster = sorted[0];
        } else {
          monster = eligible[Math.floor(Math.random() * eligible.length)];
        }

        placements.push({
          monsterKey: monster[0],
          ...monster[1],
          x: tile.x,
          y: tile.y,
          currentHP: monster[1].hp,
          maxHP: monster[1].hp,
          id: `monster_${placements.length}`,
          roomId: room.id,
        });
      }
    }

    return placements;
  }

  // Get floor tiles in a room (for placing things)
  static _getFloorTiles(grid, room) {
    const tiles = [];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (grid[y][x] === TILE_TYPES.FLOOR) {
          tiles.push({ x, y });
        }
      }
    }
    return tiles;
  }

  static _roomCenter(room) {
    return {
      x: Math.floor(room.x + room.w / 2),
      y: Math.floor(room.y + room.h / 2),
    };
  }

  static _randRange(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Reveal fog of war around a position (vision radius)
  static revealFog(fog, x, y, grid, radius = 5) {
    const revealed = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (ny < 0 || ny >= fog.length || nx < 0 || nx >= fog[0].length) continue;

        // Check if within circular radius
        if (dx * dx + dy * dy > radius * radius) continue;

        // Simple line-of-sight: check if any wall blocks the view
        if (this._hasLineOfSight(grid, x, y, nx, ny)) {
          if (!fog[ny][nx]) {
            fog[ny][nx] = true;
            revealed.push({ x: nx, y: ny });
          }
        }
      }
    }
    return revealed;
  }

  // Bresenham's line algorithm for line-of-sight
  static _hasLineOfSight(grid, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let cx = x0, cy = y0;
    while (cx !== x1 || cy !== y1) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }

      // If we hit a wall before reaching target, no LOS
      if ((cx !== x1 || cy !== y1) && grid[cy] && grid[cy][cx] === TILE_TYPES.WALL) {
        return false;
      }
    }
    return true;
  }

  // Generate a room description for narrative
  static describeRoom(room, monsters, hasChest, hasTrap) {
    const sizes = ['cramped', 'small', 'modest', 'spacious', 'vast'];
    const sizeIdx = Math.min(Math.floor((room.w * room.h) / 20), sizes.length - 1);
    const sizeWord = sizes[sizeIdx];

    const features = ['stone-walled', 'dimly lit', 'musty', 'damp', 'torch-lit', 'cobweb-covered', 'ancient'];
    const feature = features[Math.floor(Math.random() * features.length)];

    let desc = `You enter a ${sizeWord}, ${feature} chamber.`;

    if (monsters.length > 0) {
      if (monsters.length === 1) {
        desc += ` A ${monsters[0].name} lurks in the shadows!`;
      } else {
        desc += ` ${monsters.length} creatures stir in the darkness!`;
      }
    }

    if (hasChest) {
      desc += ' A weathered chest sits against the far wall.';
    }

    if (hasTrap) {
      // DM info only — players shouldn't see this without Perception check
      desc += ' [DM: A trap is hidden in this room.]';
    }

    return desc;
  }
}

module.exports = DungeonGenerator;
