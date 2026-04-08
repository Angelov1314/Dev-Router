# Dev Router

Local project launcher dashboard — one-click to `npm run dev` and open in browser.

![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![macOS](https://img.shields.io/badge/platform-macOS-blue)

## What it does

- Auto-scans directories for projects with `package.json`, Python entry points, Godot projects, or static HTML
- One-click start: runs `npm run dev` / `python3 app.py` / etc. and auto-opens browser when ready
- Port conflict detection: warns when a port is occupied, offers to kill the blocking process
- Real-time log viewer per project
- Type-based filtering (Node.js / Python / Godot / Static)
- Group-based layout for multiple project directories

## Supported project types

| Type | Detection | Default Port |
|------|-----------|-------------|
| Next.js | `next dev` in scripts | 3000 |
| Vite | `vite` in scripts | 5173 |
| Python (Flask) | `app.py` / `server.py` | 5000 |
| Python (Django) | `manage.py` | 8000 |
| Godot | `project.godot` | — |
| Static HTML | `index.html` at root | — |

## Setup

```bash
# Clone
git clone https://github.com/Angelov1314/dev-router.git ~/Claude/dev-router

# Run
node server.js
# → opens http://localhost:4000
```

### macOS App (one-click launch)

A `Dev Router.app` bundle sits on Desktop. Double-click to start the server and open the dashboard. See `create-app.sh` to rebuild it.

## Configuration

Edit `PROJECT_DIRS` in `server.js` to add scan directories:

```js
const PROJECT_DIRS = [
  { path: "/Users/you/projects", label: "Projects" },
  { path: "/Users/you/work", label: "Work" },
];
```

## Architecture

```
server.js    — Node.js HTTP server, zero dependencies
               - Project scanner (multi-directory, multi-type)
               - Process manager (spawn/kill dev servers)
               - Port conflict detection (lsof-based)
               - REST API for dashboard

index.html   — Single-file dashboard
               - Auto-refresh status every 3s
               - Port conflict modal with Kill & Start
               - Real-time log viewer
               - Type filtering + group layout
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | All projects with running state, ports, conflicts |
| `/api/ports` | GET | Currently occupied ports on system |
| `/api/start` | POST | Start a project (`{ name, forceStart? }`) |
| `/api/stop` | POST | Stop a project (`{ name }`) |
| `/api/kill-port` | POST | Kill process on a port (`{ port }`) |
| `/api/logs?name=` | GET | Get log output for a running project |
| `/api/folder` | POST | Open project folder in Finder (`{ path }`) |
