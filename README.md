# IBVAP - Intelligent Border Video Analytics Platform

AI software that turns the CCTV cameras already installed at border outposts into an intelligent surveillance
network, with no new camera hardware.

**Smart India Hackathon - Problem Statement 26187:** AI-Based Intelligent Video Analytics Platform for Border
Surveillance using Existing CCTV Infrastructure.

## Folder structure

```
frontend/        React Command Center dashboard (complete, runs on mock data)
  docs/          API_CONTRACT.md (every endpoint and JSON shape), VERIFICATION.md (honest feature check)
docs/            Research report and team guides (PDF)
legacy/          Old Streamlit prototype (app.py), kept for reference
backend/         FastAPI + SQLite backend (upcoming, built from frontend/docs/API_CONTRACT.md)
ai_engine/       Python AI engine: YOLO detection, ByteTrack tracking, virtual fence, ANPR, face (upcoming)
CLAUDE.md        Architecture and design rules for the codebase
IBVAP_Frontend_Guide.pdf   Hinglish guide to the dashboard: how it works, every page, demo story
```

## Run the frontend (mock mode, no backend needed)

Requires Node.js 20+.

```bash
cd frontend
npm install
cp .env.example .env      # VITE_USE_MOCK=true
npm run dev               # http://localhost:5173
```

Pick a role on the login screen (Operator / Commander / Admin) and press **Enter Command Center**.
Press **Ctrl+Shift+D** inside the dashboard to run the scripted demo ("Punjab sector, foggy night, drone drop").

Production build: `npm run build`, then `npm run preview` (http://localhost:4173).

## Documents in docs/

| File | What it is |
|---|---|
| `IBVAP_Border_Surveillance_Research.pdf` | Background research: current border problems, level of automation, evidence on AI video analytics, 38 sources |
| `IBVAP_Project_Guide.pdf` | Project overview, terms, one-week MVP scope, free tools, data sources, 7-day plan |
| `IBVAP_AI_Engine_Guide.pdf` | Step-by-step guide for building the AI engine and connecting it to the backend |

Also: `frontend/docs/API_CONTRACT.md` (backend / AI-engine contract) and `IBVAP_Frontend_Guide.pdf` (dashboard guide).

## Current status

- **Frontend: complete on mock data.** Command Center, live cameras (incl. thermal / IR), map with drone watch
  and police nakas, alerts with clip player, incident grouping, playbooks, evidence export, ANPR, face watchlist,
  forensic search, zones editor, shift handover, QRT mobile view, audit log, edge-node health, Hindi / English.
- **Backend and AI engine: in progress.** The frontend switches to the real backend by setting
  `VITE_USE_MOCK=false` once it exists.

## Team

| Name | Role |
|---|---|
| _Member 1 (to be added)_ | AI engine |
| _Member 2 (to be added)_ | Frontend, backend |
