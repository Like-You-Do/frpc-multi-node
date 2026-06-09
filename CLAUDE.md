# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FRP 多节点客户端 — a uTools plugin for managing multiple FRP (Fast Reverse Proxy) client connections. It provides a GUI to configure servers and tunnels, generates `frpc.toml` config files, and spawns `frpc.exe` processes to establish tunnels. Built with React 19 + Ant Design 6 + Vite 6.

## Build & Dev Commands

- **Dev server**: `npm run dev` (Vite on localhost:5173; uTools plugin.json points here in development mode)
- **Production build**: `npm run build` (outputs to `dist/`)
- **Lint**: `npx standard` (uses `standard` ESLint config, no Prettier)

No test framework is configured.

## Architecture

### Dual-environment design

The app runs in two environments with a graceful fallback:

1. **uTools plugin** (production): `window.services` is injected by the preload script (`public/preload/services.js`), which runs in Node.js via uTools' preload mechanism. This provides file I/O and `frpc.exe` process management.
2. **Browser** (development fallback): When `window.services` is absent, the app falls back to `localStorage` for config persistence and shows warnings that frpc.exe cannot be launched.

### Preload layer (`public/preload/services.js`)

Runs as CommonJS (`public/preload/package.json` sets `"type": "commonjs"`). Exposes `window.services` with these key APIs:

- `writeFrpcToml(content, fileName)` / `deleteFrpcToml(fileName)` — write/delete toml configs to uTools userData path
- `startFrpcTunnel(tunnelKey, content, fileName)` — writes config then spawns `frpc.exe -c <configPath>`; tracks processes in a `Map` keyed by `tunnelKey`
- `stopFrpcTunnel(tunnelKey)` — kills the tracked child process
- `getFrpcTunnelLog(tunnelKey)` / `getFrpcTunnelStatus(tunnelKey)` — read process logs/status

Process logs are capped at 1000 lines per tunnel. `frpc.exe` is located by searching multiple candidate paths.

### Renderer layer (`src/`)

Single-page app with sidebar navigation. All state lives in `App.jsx` and is passed down as props. Three pages:

- **隧道设置 (Tunnel Settings)** — CRUD for tunnels, start/stop switches, log viewer
- **服务端设置 (Server Settings)** — CRUD for servers with extra key-value fields
- **环境设置 (Environment Settings)** — placeholder page

### Data model

- **Server**: `{ id, key, configFile, ip, port, token, extra }` — each server owns one `frpc_<id>.toml`
- **Tunnel**: `{ id, key, serverId, type, name, ... }` — two shapes depending on type:
  - Proxy tunnels (`tcp`/`udp`): `localIP`, `localPort`, `remotePort` → generates `[[proxies]]` in toml
  - Visitor tunnels (`stcp`/`xtcp`): `serviceName`, `secretKey`, `bindAddr`, `bindPort` → generates `[[visitors]]` in toml

### TOML generation

`buildFrpcToml(server, tunnels)` in `App.jsx` generates the full frpc config string. All string values are escaped via `escapeTomlString()`. Key names are quoted via `formatTomlKey()` when they contain non-identifier characters.

### uTools plugin config (`public/plugin.json`)

Defines three features: `hello` (demo), `read` (file reader), `write` (file saver). The main app pages (tunnel/server/environment) are not registered as plugin features — they are the default view.

## Key Conventions

- All UI text is in Chinese
- The `Hello/`, `Read/`, `Write/` components are uTools feature demos, not part of the main FRP management UI
- `frpc.exe` is bundled in `public/` and copied to `dist/` on build
- The preload script must remain CommonJS (uTools requirement)
- Config files are written to `utools.getPath('userData')` in production, `localStorage` in dev
