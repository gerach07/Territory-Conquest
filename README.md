# 🏴 Territory Conquest — Multiplayer Territory Game

A real-time multiplayer territory-claiming game inspired by Paper.io.
Capture territory by enclosing areas with your trail — but don't get cut!

> **Play now:** [absnakeab.web.app](https://absnakeab.web.app)

---

## Tech Stack

| Component | Technology | Path |
|-----------|-----------|------|
| **Client** | React 18 · Tailwind CSS · Socket.IO | [`client/`](client/) |
| **Server** | Node.js · Express · Socket.IO · msgpack | [`server/`](server/) |

## Features

- **Create & join** rooms with optional PIN protection
- **Host controls** — start game, kick players, toggle spectators
- **Real-time gameplay** — 10Hz server tick rate with 60fps client interpolation
- **Territory capture** — flood-fill algorithm for enclosed area detection
- **Client-side prediction** — smooth movement with server reconciliation
- **Spectator mode** — watch ongoing games (up to 20 per room)
- **In-game chat** with rate limiting
- **Reconnection** — 15-second grace period with seamless state restoration
- **Play again / rematch** voting after game ends
- **Configurable timer** — 1–10 minute games or unlimited
- **3 languages** — English, Latvian, Russian
- **Sound effects** — synthesized tones
- **Dark/Light theme** toggle
- **Binary serialization** — msgpack for bandwidth-efficient game state updates
- **Up to 6 players** per room with 8 color choices

## Quick Start

### Prerequisites

- **Node.js** 18+

### Development

```bash
npm run install:all
npm run dev
```

Opens client at [http://localhost:3000](http://localhost:3000) — server runs on port 3001.

### Client Only

```bash
cd client && npm start
```

### Server Only

```bash
cd server && npm run dev
```

## Environment Variables

### Server (`server/.env`)

Copy from `server/.env.example`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port (Render uses 10000) |
| `ALLOWED_ORIGINS` | localhost + Firebase URLs | Comma-separated CORS origins |
| `NODE_ENV` | `development` | Runtime environment |

### Client

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_SERVER_URL` | _(none)_ | Override server URL at build time |

> When not set, the client auto-detects: tries localhost first, falls back to the production Render server.

## Server

The backend is deployed on **Render**:

```
https://territory-conquest.onrender.com
```

Health check: [`/health`](https://territory-conquest.onrender.com/health)

## Project Structure

```
├── client/                 # React frontend (Firebase hosted)
│   ├── src/
│   │   ├── components/     # GameCanvas, LoginView, WaitingRoom, ChatBox, etc.
│   │   ├── hooks/          # useSocket (auto-fallback connection)
│   │   ├── i18n/           # en.json, lv.json, ru.json
│   │   ├── utils/          # Sound, helpers
│   │   ├── App.js          # Main game component
│   │   └── constants.js    # Shared constants (must match server)
│   └── public/
├── server/                 # Node.js/Express/Socket.IO backend
│   ├── server.js           # Entry point, socket handlers, HTTP API
│   ├── src/
│   │   ├── constants.js    # Game constants (grid, tick rate, colors)
│   │   ├── models/Room.js  # Game room (territory capture, movement, scoring)
│   │   └── utils/          # RateLimiter, sanitizers
│   ├── render.yaml         # Render deployment config
│   ├── Dockerfile          # Docker build (used by Render)
│   └── test-validation.js  # Server test suite (59 tests)
├── firebase.json           # Firebase Hosting config
├── start.js                # Dev launcher (auto port cleanup)
└── package.json            # Root scripts
```

## Deployment

| Component | Platform | Command |
|-----------|----------|---------|
| **Client** | Firebase Hosting | `npm run deploy` |
| **Server** | Render (Node.js) | Auto-deploys on push to `main` |

## Game Mechanics

- **Grid**: 80×80 cells
- **Movement**: Continuous in 4 directions at 10 ticks/second
- **Trail**: Moving outside your territory leaves a trail
- **Capture**: Return to your territory to claim all enclosed area (flood-fill)
- **Kill**: Cut another player's trail to eliminate them (3s respawn)
- **Collision**: Head-on collision kills player(s) who are trailing
- **Scoring**: Territory percentage (your cells / 6400 × 100)
- **Latency compensation**: Grace window based on player RTT (capped at 300ms)
