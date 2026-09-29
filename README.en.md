<p align="center">
  <img src="./public/logo.png" alt="ID Plan Logo" width="120" />
</p>

<h1 align="center">ID Plan</h1>

<p align="center">
  <strong>Turn a project into one readable stage timeline — an offline-first scheduling tool.</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-0.8.3.0001-blue.svg" alt="version" />
  <img src="https://img.shields.io/badge/tests-1825%20passing-brightgreen.svg" alt="tests" />
  <img src="https://img.shields.io/badge/Electron-44-47848F.svg" alt="Electron" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20NAS%20%7C%20Browser-lightgrey.svg" alt="platform" />
</p>

<p align="center"><a href="./README.md">中文</a> · <strong>English</strong></p>

> Born in the interior-design workflow, now covering **9 domains / 21 stage presets**. Turn budget, project type, stage milestones and members into one timeline — read it as a kanban, calendar or gantt, and export a schedule page you can hand straight to a client.
> **It also lets external AI writers (WorkBuddy / Codex, etc.) onboard by reading a single file and write tasks directly into your board** — see [🤖 Agent Access](#-agent-access).

---

## 💡 Why this exists

I'm a designer myself. Every project used to cost me half a day just tracking milestones, scheduling, and keeping members aligned — so I built this: stages, tasks, members and schedules in one place, progress management inside the same operation, one-click export for clients. **Clear stages. Visible progress.**

It ships in three forms: **Windows desktop** (data on your machine), **UGREEN NAS** (team-shared), and **Browser / Docker**. All three share the same scheduling engine and stage library.

---

## ✨ Highlights

### 🧭 Project setup: pick the domain, get the stages
- **Three-level cascading setup** — domain → sub-domain → stage preset. Nothing is pre-selected on first open; the presets and stages only appear after you pick a sub-domain.
- **9 domains** — interior / landscape / architecture / software / marketing / film production / weddings / consulting delivery / travel.
- **21 stage presets** — each domain has stages that fit its own workflow (not the interior nine stages renamed). Travel runs "Planning → Itinerary Design → Resource Booking → Pre-departure → Execution → Settlement → Review"; software runs "Planning → Design → Development → Testing → Release".
- **Board columns follow the domain** — interior gets design / detailing / construction; film gets pre-production / shooting / post-production / delivery.

### 📐 Scheduling & delivery
- **Configurable rest policy** — long/short weekends, single/double days off; scheduling skips rest days automatically, so completion dates hold up.
- **Multiple views** — kanban, calendar, drag-to-reschedule gantt timeline.
- **Print / export** — A4 print view for schedules, high-res PNG export.
- **Travel day-by-day itinerary** — travel projects generate daily itinerary cards from the project dates, printable as a client-facing itinerary; hidden for non-travel projects.
- **Three themes** — light / dark / follow system.

### 👥 Collaboration
- **Task assignment** — tasks can be assigned to multiple members; assignees can check off their own completion, progress syncs live.
- **Role permissions** — admins see everything; members only see projects and tasks related to them.
- **Member boards** — each member sees their own relevant project progress after signing in.
- **Password sign-in** — admins can set / clear per-member passwords.

### 💾 Data
- **Backup & restore** — one-click JSON export / import with full validation; backups from older versions import safely.
- **Offline-first** — desktop data lives in local IndexedDB, no network required.

---

## 🤖 Agent Access

ID Plan has a built-in **local loopback channel** (`127.0.0.1:17788`) that makes external AI writers first-class citizens of your scheduler:

- **One-file onboarding** — the ingress panel generates an ingress file at a fixed path (address / token / endpoints / payload schema, all inside); an external Agent reads one file and is connected. Rotate the token? Just re-read.
- **Self-service board creation** — a writer can create its own Agent board (name + start/end dates + stage set; missing any one is rejected)
- **Idempotent import** — `idplan-agent-payload/v1` schema; idempotency key `externalId` (replays never duplicate numbers); dependencies resolve by `externalId`; dryRun preview supported (what you see is what gets written)
- **Read-back verification** — a read-only task stream lets writers verify what actually landed
- **Structural isolation** — the write target can only be an Agent board (`kind=agent`); **human projects are always rejected** (`project_unresolved`). The gate lives in one shared core — desktop and NAS channels enforce the same code.
- **Manual fallback** — when not using the channel, a copyable prompt and JSON template are built in.

**In progress**: the Agent execution console UI (the data layer is ready: `Execution` / `ExecutionAttempt` / `ExecutionEvent` / `WritebackProposal`; the state machine is enforced at the storage boundary); NAS remote auto-write (connectivity probe only for now).

---

## 🚀 Quick start

```bash
git clone https://github.com/chengcheng067/idplan.git
cd idplan
npm install

npm run dev            # frontend at http://localhost:5173
# or electron:dev      # desktop form
```

```bash
npm test               # full unit suite (vitest)
npm run typecheck      # frontend / server typecheck
npm run build          # typecheck + build
npm run electron:build # build + Windows NSIS installer
```

> **Run `npm run build` before tests**: a batch of real-browser geometry acceptance cases depends on the `build-dist` output — without it they get skipped, and **skipped cases don't count as passing**.
>
> **Data source**: `VITE_DATA_SOURCE=local` (local IndexedDB, default) or `remote` (NAS backend) in `.env.local`; fixed at process start, restart after changes.

## 🏗️ Architecture

```
┌─ Electron desktop shell (Windows) ───────────────────┐
│  Main process: loopback HTTP channel (IPC → renderer) │
│  Renderer: React 18 + Zustand + Dexie(IndexedDB)      │
├─ Browser / NAS form ─────────────────────────────────┤
│  Frontend: same React (build-dist)                    │
│  Server: Fastify + SQLite (team-shared data layer)    │
├─ Shared core (src/core) ─────────────────────────────┤
│  payload.apply.ts: target resolution / ownership gate │
│  ↳ four paths desktop & server share one source      │
└──────────────────────────────────────────────────────┘
```

**Same semantics on both channels**: the four Agent endpoints (health / boards / import / tasks) are implemented symmetrically on desktop (loopback + IPC) and NAS (Fastify + real SQLite); a dedicated regression spec pins cross-channel "same input → same result".

---

## 📦 Install & download

### Windows desktop (personal use)
Download the installer and double-click; data stays **on your machine**: 📄 [Install guide](docs/install/windows-install.md)
> No code-signing certificate, so Windows SmartScreen may show "Unknown publisher" → **More info** → **Run anyway**.

### UGREEN NAS (team sharing)
Data lives on the NAS; everyone sees the same picture. You only need a UGREEN NAS (UGOS Pro) + a browser:
- 📦 **UPK app package** (easiest): [tutorial](docs/install/upk-install-tutorial.md)
- ⚙️ **Docker compose** (manual): [tutorial](docs/install/nas-deploy-tutorial.md) · [compose file](docs/install/idplan-nas-compose.yml)

### Docker (generic / self-hosted)
```bash
ghcr.io/chengcheng067/idplan:<version>          # frontend (nginx + /api reverse proxy)
ghcr.io/chengcheng067/idplan-backend:<version>  # backend (Fastify + SQLite)
```

**All release artifacts are on GitHub Releases**: 👉 https://github.com/chengcheng067/idplan/releases

---

## 🛠️ Tech stack

| Layer | Tech |
|---|------|
| Desktop shell | Electron 44 |
| Frontend | Vite 5 + React 18 + TypeScript 5 |
| State | Zustand |
| Local storage | Dexie 4 (IndexedDB) |
| Styling | Tailwind CSS 3 |
| Server | Fastify 4 + SQLite (team-shared data layer) |
| Validation | Zod |
| Testing | Vitest + fake-indexeddb |
| Packaging | electron-builder → NSIS (Windows) / UGREEN UPK |

---

## 📖 Docs

- 🪧 [Windows install](docs/install/windows-install.md) · 📦 [NAS · UPK](docs/install/upk-install-tutorial.md) · ⚙️ [NAS · Docker](docs/install/nas-deploy-tutorial.md)
- 🔌 [API contract (four Agent endpoints)](docs/api-contract.md) · 🗂️ [Backup format](docs/backup-format.md) · 🧪 [Migration drill](docs/migration-drill.md)
- 🗺️ [Roadmap (including the "explicitly not doing" list)](docs/roadmap.md)

---

## 🗺️ Status

| Capability | Status |
|------|------|
| Multi-domain setup, scheduling, kanban / calendar / gantt, print & export | ✅ Ready |
| Travel daily itinerary & client itinerary sheet | ✅ Ready |
| Agent loopback auto-import, manual paste import | ✅ Ready |
| Agent execution console UI | 🔴 Not connected (data layer ready) |
| Launching & tracking Agent runs from ID Plan | 🔴 Not connected (external write channel only) |
| NAS remote auto-write | 🔴 Not enabled (connectivity probe only) |

---

## 🤝 How to contribute

- **Feature requests / bugs** — open an Issue or a PR
- **Domain templates** — know an industry? Submit a template PR (the stage library is a pure JSON addition, zero migration)
- **Interaction / visual improvements** — UI copy, flows, icons
- **Code** — tests in vitest, PRs welcome; by submitting you agree to merge your contribution under the same MIT license as this project

---

## ⚖️ License

Open-sourced under the **[MIT License](./LICENSE)** — you are free to use, copy, modify, merge, publish, distribute, sublicense and sell copies, including commercially. The only requirement is keeping the copyright and permission notices. **No separate commercial license needed, and no fee.**

> The intent: let more designers, small teams and students dare to use it, change it and pass it on — that's how this tool stays alive.

---

## 💬 Last word

If you have a similar need, or any thoughts on this project, open an Issue or PR. Let's make it better together.

> **ID Plan — clear stages, visible progress.**

---

© 2026 杨雯丞 (ChengCheng) · [GitHub](https://github.com/chengcheng067/idplan)
