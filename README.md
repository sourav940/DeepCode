# DeepCode — Remote Containerized Cloud IDE

A full-stack, browser-based Cloud IDE delivering real-time code execution, collaborative editing, and intelligent code analysis — built from scratch in 8 days.

**Live Demo:**(https://deep-code-388kqiqlq-sourav941.vercel.app/)
**Backend:**(https://deepcode-5ln5.onrender.com)
**GitHub:** https://github.com/sourav940/DeepCode

---

## Overview

DeepCode is a production-grade Cloud IDE similar to CodeSandbox or Replit where users can write, execute, debug, and collaborate on code in real time.

---

## Live Deployment

| Service | URL |
|---------|-----|
| Frontend (Vercel) |(https://deep-code-388kqiqlq-sourav941.vercel.app/) |
| Backend (Render) |(https://deepcode-5ln5.onrender.com) |

> Backend runs on Render free tier. First request may take 30-60 seconds (cold start). UptimeRobot pings every 5 minutes to minimize this.

---

## Features

### 1. Isolated Code Execution Engine (25 marks)
- Piston API integration for sandboxed code execution
- Supports Python 3, JavaScript (Node.js), and C++
- Local fallback runner with 5-second timeout protection
- Clean stdout/stderr separation with color-coded output

### 2. Real-Time Interactive Terminal (25 marks)
- `node-pty` spawns a real native shell (PowerShell/Bash)
- `xterm.js` renders a fully interactive browser terminal
- Bidirectional WebSocket pipe: keystrokes → PTY → output → browser
- Terminal session persistence with 2-minute grace period on disconnect
- Split-pane multi-terminal: multiple simultaneous shell instances
- ANSI colors, cursor positioning, and terminal resize support

### 3. Automated AST Code Reviewer & Linter (25 marks)
- ESLint v8 programmatic API — no CLI subprocess overhead
- Real-time linting with 500ms debounce after typing stops
- Inline Monaco Editor markers — red/yellow squiggly lines
- Problems tab with clickable diagnostics that jump to error line
- Rules: `no-var`, `eqeqeq`, `no-unused-vars`, `no-constant-condition`, `no-eval`, `no-implied-eval`, `no-unreachable`
- Python/C++ auto-filtered — ESLint only runs on JavaScript

### 4. Collaborative Pair Programming (25 marks)
- **Yjs CRDT** — conflict-free real-time collaborative editing
- `y-monaco` binding — Monaco Editor directly synced with Yjs document
- Cursor presence — each collaborator's cursor visible with unique color
- Room-based sessions — generate or join with 6-character room codes
- **WebRTC P2P voice call** via `simple-peer` + Socket.io signaling
- Mute/unmute controls during active voice sessions

---

## Tech Stack

### Frontend
| Technology | Purpose |
|-----------|---------|
| React 18 + Vite | UI framework, fast dev server |
| Monaco Editor | VS Code engine — syntax highlighting |
| xterm.js + FitAddon | Browser terminal emulator |
| Yjs + y-monaco | CRDT collaborative editing |
| y-websocket | Yjs WebSocket provider |
| simple-peer | WebRTC P2P voice |
| socket.io-client | WebRTC signaling |
| Axios | HTTP requests |
| Lucide React | Icons |

### Backend
| Technology | Purpose |
|-----------|---------|
| Node.js + Express | HTTP server + REST API |
| ws | Raw WebSocket — terminal stream |
| node-pty | Pseudo-terminal — real shell |
| y-websocket | Yjs document sync server |
| socket.io | WebRTC signaling |
| ESLint v8 | Programmatic code analysis |
| Piston API | Sandboxed code execution |

### Infrastructure
| Service | Purpose |
|---------|---------|
| Vercel | Frontend hosting |
| Render | Backend Node.js hosting |
| UptimeRobot | Cold-start prevention |

---

## Architecture

### Single-Port Backend Design

All services on **Port 3000** — path-based routing:
