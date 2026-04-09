# Dungeon Crawl VTT

A browser-based multiplayer tabletop RPG with an AI Dungeon Master. Explore procedurally generated dungeons, fight monsters, find treasure, and descend deeper into the darkness — all from your browser.

Built as a single-page web app with real-time WebSocket synchronization. No accounts, no downloads, just share the link and play.

## Features

- **AI Dungeon Master**: Procedurally generated dungeons with narrative descriptions, room encounters, traps, chests, and boss fights
- **Real-time multiplayer**: WebSocket-based state sync via Socket.IO — invite friends by sharing the URL
- **Character creation**: 8 races, 8 classes, 4d6-drop-lowest ability scores, full equipment and spell selection
- **Turn-based combat**: Initiative rolls, attack/damage rolls, spell casting, death saves — faithful to 5e SRD mechanics
- **Procedural dungeons**: Grid-based generation with rooms, corridors, doors, traps, chests, and stairs to deeper levels
- **Fog of war**: Explore to reveal the map — your vision has limited range
- **3 game modes**: Casual (simplified rules), Classic 5e (faithful to SRD), Story (narrative-focused)
- **Smart monster AI**: Enemies move, attack, and target intelligently during combat
- **Interactive map**: Canvas rendering with zoom/pan, pathfinding preview, animated tokens
- **Dice roller**: Click dice buttons or type `/roll 2d6+3` in chat
- **How to Play tutorial**: 6-slide guide for new players, plus contextual gameplay hints
- **Responsive UI**: Dark fantasy theme, works on desktop and tablet

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express 5 |
| Real-time | Socket.IO 4.8 |
| Frontend | Vanilla JavaScript + HTML Canvas |
| State | Server-authoritative (no client trust) |
| AI DM | Procedural generation + narrative engine |

**~5,500 lines of code** across 9 source files. Zero external frontend dependencies.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0

### Local Development

```bash
git clone https://github.com/Kamalesh-Kavin/dnd-vtt.git
cd dnd-vtt
npm install
npm run dev
```

Open `http://localhost:3001` in your browser. Share the URL with friends on your network.

### Production

```bash
npm start
```

The server reads the `PORT` environment variable (defaults to 3001).

## Deployment

### Render (Recommended)

This repo includes a `render.yaml` blueprint for one-click deployment:

1. Connect this repo on [Render](https://render.com)
2. Create a new **Blueprint** and select this repository
3. Render auto-configures everything from `render.yaml`
4. Your game will be live at the assigned URL

## How to Play

1. **Join**: Enter your name and click "Join Game"
2. **Configure**: Choose AI DM or Human DM, game style, and difficulty
3. **Create your character**: Pick a race, class, and roll ability scores
4. **Explore**: Click tiles on the map to move. Dark areas are unexplored — move closer to reveal them.
5. **Combat**: Encounters trigger automatically. Choose Attack, Cast Spell, or End Turn when it's your turn.
6. **Loot**: Walk over chests for gold, potions, and weapons.
7. **Descend**: Find stairs and click "Descend" to go deeper. Your party rests between floors.
8. **Survive**: Watch your HP. If you hit 0, you start making death saves!

## Project Structure

```
dungeon-crawl-vtt/
├── server/
│   ├── index.js              # Express + Socket.IO server (409 lines)
│   ├── game/
│   │   ├── GameState.js      # Core game state engine (1027 lines)
│   │   ├── Combat.js         # 5e SRD combat engine (585 lines)
│   │   ├── DungeonGenerator.js  # Procedural dungeon generation (437 lines)
│   │   └── DiceRoller.js     # Dice rolling utility (209 lines)
│   └── data/
│       └── rules.js          # 5e SRD data: races, classes, spells, monsters (456 lines)
├── public/
│   ├── index.html            # Single-page app with tutorial overlay (377 lines)
│   ├── css/
│   │   └── style.css         # Dark fantasy theme (887 lines)
│   └── js/
│       └── client.js         # Game client: canvas, UI, sockets (1552 lines)
├── package.json
├── render.yaml               # Render deployment blueprint
├── LICENSE                   # MIT License
└── .gitignore
```

## Game Content Attribution

This work includes material from the **System Reference Document 5.1** (SRD 5.1), Copyright 2016, Wizards of the Coast, Inc., licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

This project is **not affiliated with, endorsed by, or sponsored by** Wizards of the Coast, Hasbro, or any of their subsidiaries.

## License

[MIT](LICENSE)
