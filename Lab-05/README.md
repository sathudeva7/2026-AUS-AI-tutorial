# Lab 1 — A Practical Guide to AI Agents in the Enterprise

Two customer-support agents running side-by-side against the same prompt: a first-cut `cs_agent_v1` and a redesigned `cs_agent_v2`. Same model, same prompt, different traces. The diff is the lesson.

The web UI ships with the prompts and a session/model picker — just run it and try them.

---

## Prerequisites

Install these before running the steps below:

- **Python 3.11+** — `python3 --version`
  - macOS: `brew install python@3.11`
  - Ubuntu/Debian: `sudo apt install python3.11 python3.11-venv`
  - Windows: install from [python.org](https://www.python.org/downloads/) or use WSL2
- **Node 18+** and **npm** — `node --version`
  - macOS: `brew install node`
  - Ubuntu/Debian: `sudo apt install nodejs npm`
  - Windows: install from [nodejs.org](https://nodejs.org/) or use WSL2
- **`make`** — `make --version`
  - macOS: included with Xcode CLT (`xcode-select --install`)
  - Ubuntu/Debian: `sudo apt install build-essential`
  - Windows: use **WSL2** or **Git Bash** (the Makefile uses bash features that don't run in PowerShell)
- **An OpenAI API key** with access to `gpt-5.4-mini` (or another supported model — see the model dropdown in the UI)

---

## Setup

```bash
cd 2026-AUS-AI-tutorial/Lab-01
make install
```

`make install` does:

- Creates `cs_agent_v1/.venv` and installs its Python deps from `cs_agent_v1/pyproject.toml`
- Creates `cs_agent_v2/.venv` and installs its Python deps from `cs_agent_v2/pyproject.toml`
- Runs `npm install` in `web/`
- Copies `.env.example` to `.env` if it doesn't exist yet

Then open `Lab-01/.env` and paste your key:

```
OPENAI_API_KEY=sk-...
```

One `.env` covers the whole lab — both agent services read it.

---

## Run

```bash
make dev
```

Three processes come up in parallel:

| Process | Port | URL |
|---|---|---|
| `cs_agent_v1` | `:8001` | http://localhost:8001 |
| `cs_agent_v2` | `:8002` | http://localhost:8002 |
| `web` | `:5173` | http://localhost:5173 |

Open **<http://localhost:5173>** in your browser. Ctrl-C in the terminal stops all three together.

### Running one service at a time

Useful for debugging a single agent:

```bash
make v1     # cs_agent_v1 only (with --reload)
make v2     # cs_agent_v2 only (with --reload)
make web    # frontend only
```

---

## Reset between runs

The web UI's **reset** button hits both services' `/api/reset` endpoints — restores mocks from seeds, wipes conversation memory, clears non-seed episodic memory.

When the services aren't running:

```bash
make reset
```

If Bob's episodic memory was modified by `compact_memory()` during a demo:

```bash
git restore cs_agent_v2/memory/episodic/customer_cust_002.md
```

---

## Clean

```bash
make clean
```

Removes both venvs, `web/node_modules`, and build artifacts. Re-run `make install` afterward.

---

## Troubleshooting

- **`make dev` says port 5173 is in use.** Vite walks up the range (`5174`, `5175`, …). Both agents' CORS allowlists cover `:5170`–`:5189`, so any in-range port works.
- **Port 8001 / 8002 is in use.** `lsof -i :8001` (or `:8002`) to find what's bound. Kill it, or change the ports in the `Makefile` and the `AGENTS` entries in `web/src/lib/api.ts`.
- **`command not found: bash` on Windows.** Install **Git Bash** or switch to **WSL2** and re-run.
- **`No such file or directory: 'python'`** when an agent starts. The MCP subprocess can't find `python` on `PATH`. `cs_agent_v2/agent/core.py` substitutes `sys.executable` for `python` / `python3` in the MCP server config — if you still see this, you're on a non-standard Python install; make sure `python3` resolves and the venv was created cleanly.
- **OpenAI auth / 401 errors.** Confirm `OPENAI_API_KEY` is set in `Lab-01/.env` and the key has access to the model selected in the UI (default `gpt-5.4-mini`).
- **CORS errors in the browser console.** Confirm the web is on `:5170`–`:5189`. The CORS regex in `cs_agent_v*/main.py` covers that range.

---

## Repo layout

```
Lab-01/
├── cs_agent_v1/        First-cut agent service (port 8001)
├── cs_agent_v2/        Production-shaped agent service (port 8002)
├── mocks/              Shared mock backend (Customer / Order / Ledger + seeds)
├── policies/           Shared policy docs (markdown)
├── web/                React + Vite + Tailwind frontend (port 5173)
├── Makefile            make install / dev / v1 / v2 / web / reset / clean
├── reset.py            Reset script used when services aren't running
├── .env.example        Copy to .env, paste OPENAI_API_KEY
├── slides.md           Marp deck (for presenters)
├── DEMO_SCRIPT.md      Pre-flight checklist + emergency-recovery table
└── README.md           This file
```

---

## Presenting?

See [`slides.md`](slides.md) (Marp deck, speaker notes inline) and [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (pre-flight checklist, time-check table, emergency-recovery table).
