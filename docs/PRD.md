# Dragon Math — Product Requirements Document

## Vision

A web-based math duel game targeting girls in grades 2–8. Players travel through a fantasy world, stopping at nodes along a winding road to battle opponents in math duels. The aesthetic is soft and adventurous — watercolor-style fantasy with dragons, enchanted forests, and glowing crystals.

---

## Target Audience

- **Primary:** Girls, grades 2–8 (ages 7–14)
- **Tone:** Encouraging, cozy, competitive but not punishing
- **Design inspiration:** Studio Ghibli × early girl games — pastel colors, friendly dragons, magical worlds

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Styling | Plain CSS Modules (no Tailwind) |
| Routing | react-router-dom |
| Backend API | Express (Node.js), port 3001 |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (30-day tokens, stored in localStorage) |
| Passwords | bcryptjs (12 rounds) |
| Dev runner | concurrently (Vite + Express together) |

**Start both servers:** `npm run dev`

---

## Architecture

```
Vite dev server  :5173  ←→  React frontend (src/)
Express API      :3001  ←→  SQLite (dragon-math.db)
```

---

## World Map

### Structure
- The map is a **vertically scrolling SVG** road that winds through fantasy biomes
- Pattern repeats: **7 regular nodes → 1 boss fight** → 7 regular nodes → 1 boss fight → …
- MVP ships with **2 worlds (17 nodes total)**

### Worlds (MVP)
| World | Nodes | Theme | Color |
|---|---|---|---|
| Mushroom Forest | 1–7 (+ boss 8) | Soft greens, toadstools, fireflies | Mint `#d4f5e2` |
| Crystal Caves | 9–16 (+ boss 17) | Purples, gems, ice pinnacles | Lavender `#e8d9ff` |

### Node States
| State | Appearance |
|---|---|
| Locked | Grayscale, 40% opacity, fog effect |
| Available | Full color, pulsing pink glow ring |
| Completed | Full color + gold star |
| Boss (available) | Larger circle, purple border, shake animation |
| Boss (completed) | Larger circle + crown |

### Interactions
- Clicking an **available** node opens a modal with node name, description, and a **Play** button
- Clicking a **locked** node does nothing
- Map **auto-scrolls** to the current available node on load

---

## Auth

- Email + password signup/login
- No email confirmation — account is active immediately
- JWT stored in `localStorage` as `dm_token`
- Token validated on page load via `GET /api/auth/me`
- 30-day token expiry

---

## Battle Screen (Phase 2 — to build)

### Layout
```
┌─────────────────────────────────┐
│  Problem 1: 4 × 3    Problem 2: 5 × 5  │
├─────────────────────────────────┤
│                                 │
│   6 × 6 grid of numbers         │
│   (numbers change every ~3s)    │
│                                 │
│  [Opponent avatar crawls up     │
│   from the bottom]              │
└─────────────────────────────────┘
```

### Rules
- Two math problems displayed above the grid simultaneously
- The grid is 6×6 and contains numbers — **both answers are always present**
- Numbers in the grid **shuffle/change every ~3 seconds**
- Player taps the correct answer for **either** problem to score a hit
- The **opponent** (AI) has an avatar that starts at the bottom of the grid and advances upward — answering correctly slows or reverses the opponent
- First to answer both problems wins the round
- Win enough rounds to complete the node

### Difficulty Scaling
| Grades | Operations | Number Range |
|---|---|---|
| 2–3 | Addition, Subtraction | 1–20 |
| 4–5 | Multiplication, Division | 1–12 × tables |
| 6–8 | Mixed operations, order of operations | Larger numbers |

Difficulty is set per node — earlier nodes = lower grades, later nodes and boss fights = harder.

### Boss Fights
- Same grid mechanic, but:
  - The opponent avatar is a **dragon** (vs a generic sprite for regular nodes)
  - Tighter time pressure
  - More problems to solve per round (e.g. 3 instead of 2)
  - Dramatic entry animation

### Opponent AI
- Regular nodes: opponent answers at a consistent but beatable speed
- Boss fights: opponent speeds up mid-battle
- Wrong answers by the player give the opponent a speed boost

---

## Progress & Persistence

### Database Tables

**`users`**
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| email | TEXT UNIQUE | |
| display_name | TEXT | Default: 'Dragon Tamer' |
| password_hash | TEXT | bcrypt |
| current_node_id | INTEGER | Default: 1 |
| created_at | TEXT | |

**`node_progress`**
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER FK | |
| node_id | INTEGER | |
| completed | INTEGER | 0 or 1 |
| stars | INTEGER | 1–3 |
| completed_at | TEXT | ISO timestamp |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/signup` | Create account, returns JWT |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/me` | Validate token, return user |
| GET | `/api/progress` | Get all node progress for user |
| PUT | `/api/progress/:nodeId` | Mark node complete with stars |

---

## Screens

| Screen | Route | Status |
|---|---|---|
| Login / Signup | `/auth` | ✅ Done |
| World Map | `/map` | ✅ Done |
| Battle | `/battle/:nodeId` | 🔜 Phase 2 |
| Results / Stars | (modal) | 🔜 Phase 2 |
| Profile / Stats | `/profile` | 🔜 Phase 3 |

---

## Design Tokens

```css
--world1-bg:       #d4f5e2   /* Mushroom Forest — mint green */
--world2-bg:       #e8d9ff   /* Crystal Caves — lavender */
--road-color:      #c8a96e   /* Parchment */
--node-available:  #ff9fd4   /* Hot pink glow */
--node-completed:  #ffe066   /* Gold */
--node-locked:     #b0b0b0
--boss-border:     #9b4dca   /* Purple */
--text-primary:    #3d2b5a   /* Deep purple */
--text-muted:      #7a6a8a
--header-bg:       #3d2b5a
```

---

## What's Built (Phase 1)

- [x] Vite + React project scaffold
- [x] Express + SQLite backend with JWT auth
- [x] Email signup / login / logout
- [x] World Map — 2 worlds, 17 nodes, winding SVG road
- [x] Node states (locked / available / completed / boss)
- [x] Auto-scroll to current node
- [x] Node click modal with Play button stub
- [x] Progress persisted to SQLite
- [x] GitHub repo

## What's Next (Phase 2)

- [ ] Battle screen — 6×6 number grid
- [ ] Two math problems above grid
- [ ] Grid numbers shuffle every ~3 seconds
- [ ] Tap-to-answer mechanic
- [ ] Opponent avatar that advances from bottom
- [ ] Win/lose logic → mark node complete → map updates
- [ ] Boss fight variant (dragon opponent, harder problems)
