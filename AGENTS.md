# AGENTS.md

This file is the consolidated agent operating guide for this repository. It intentionally overlaps with `CLAUDE.md` and `README.md` so an agent can get the working rules from one place.

## Project Overview

- Electron desktop app for AI audio and multimodal workflows.
- Three-process architecture: Electron shell -> FastAPI backend -> Next.js frontend.
- Supports two running modes:
- Electron desktop mode via `npx electron .`
- Docker web mode via `pnpm run docker`

## Repository Structure

### Frontend

- Location: `frontend/`
- Stack: Next.js Pages Router + TypeScript + Tailwind CSS
- Output mode: static export; production Electron loads `frontend/out/`

Preferred layout:

```text
frontend/
  types/index.ts
  constants/index.ts
  utils/index.ts
  hooks/
  components/shared/
  components/icons/
  components/layout/
  components/panels/
  pages/index.tsx
```

Frontend rules:

- Keep `frontend/pages/index.tsx` focused on layout, route state, shared settings, and hook composition.
- Put feature state and behavior into `frontend/hooks/`.
- Put reusable UI into `frontend/components/`.
- Prefer prop drilling over Context for feature state. Reserve Context for true global state only.
- Task success or failure should be shown in the task list flow, not repeated in each feature panel.

### Backend

- Location: `backend/`
- Stack: FastAPI + uvicorn

Preferred layout:

```text
backend/
  main.py
  config.py
  logging_setup.py
  job_queue.py
  utils/
  services/
  routers/
```

Backend rules:

- Keep dependency direction as `config -> utils -> services -> routers -> main`.
- Do not introduce reverse dependencies.
- Keep `main.py` thin; it should mainly initialize the app and include routers.
- Put business logic in `services/`, not in routers.
- Keep `utils/` side-effect-light and reusable.

### Runtime And Models

- `runtime/` contains embedded runtimes, engine code, and platform-specific binaries.
- `wrappers/` contains engine wrappers and manifest-driven execution metadata.
- `models/` stores voice metadata, user uploads, settings, and related project-level data.
- `checkpoints/` stores local model weights for development paths.
- Large model files, checkpoint assets, and engine binaries must not be committed unless the repo already tracks them intentionally.

## Source Of Truth

When documentation conflicts, use this order:

1. Real code paths and execution behavior
2. `package.json`
3. `main.js`
4. `backend/config.py`
5. `wrappers/manifest.json`
6. `CLAUDE.md`
7. `README.md`

Practical rule:

- Treat docs as guidance.
- Treat executable config and code as truth.

## Package Management Rules

- JS and Node: use `pnpm` only. Do not use `npm`.
- Python backend development: use `poetry` only. Do not manage backend dependencies with plain `pip`.
- Runtime engine dependencies may use embedded Python and engine-specific requirements flows already established by the repo.

## Python Environment Model

There are multiple Python layers in this repository:

- Poetry virtualenv for backend development dependencies
- Embedded Python under `runtime/{platform}/python/`
- External ML package directory for heavy libraries in development
- User data package directory for heavy libraries in packaged production mode

Core rule:

- Keep embedded Python relatively clean and stable.
- Heavy ML packages should live in external package directories, then be injected with `PYTHONPATH`.

Do not:

- Add ad-hoc dynamic `pip install` in request paths
- Install heavy ML packages directly into the embedded runtime unless the existing architecture explicitly requires it

## Standard Commands

### Development

- `pnpm run dev`
- `pnpm run setup`
- `pnpm run setup:extra`
- `pnpm run ml`
- `pnpm run ml:extra`
- `pnpm run ml:rag`
- `pnpm run ml:agent`
- `pnpm run ml:lora`
- `pnpm run checkpoints`
- `pnpm run checkpoints:check`
- `pnpm run checkpoints:force`
- `pnpm run checkpoints:extra`
- `pnpm run docker`

### Build And Package

- `pnpm run build:frontend`
- `pnpm run dist`
- `pnpm run dist:win`
- `pnpm run dist:both`

### Testing

- `poetry run pytest tests/ -v`
- `runtime/mac/python/bin/python3 tests/smoke_test.py`
- `runtime/mac/python/bin/python3 tests/smoke_test2.py`

## Dependency Installation Policy

Allowed installation stages:

1. `pnpm run setup`
2. `pnpm run setup:extra`
3. `pnpm run ml` and `pnpm run ml:extra`
4. `pnpm run checkpoints` and `pnpm run checkpoints:extra`

Strong rule:

- Do not install dependencies at request handling time.
- Do not hide missing dependency problems with silent fallback behavior.
- If something is missing, fail clearly and point to the correct setup command.

Manifest policy:

- Lightweight runtime packages belong in manifest-driven runtime install flows.
- Heavy ML packages belong in the ML install stage, not in regular backend dependency installation.

## Electron Architecture

Electron main process responsibilities:

- Start the backend Python subprocess
- Allocate backend port
- Load frontend dev server in development
- Load static exported frontend in production
- Expose capabilities through `preload.js`

Frontend responsibilities:

- Use `window.electronAPI` when Electron is available
- Fall back to local backend URL for browser or Docker flows when needed

Production path rule:

- Packaged mode must work with `RESOURCES_ROOT`, `CHECKPOINTS_DIR`, and `LOGS_DIR` passed or derived correctly.

## Core API Surface

Main endpoint groups:

- `POST /convert`
- `POST /tasks/tts`
- `POST /tasks/stt`
- `POST /tasks/llm`
- `POST /tasks/realtime`
- `POST /tasks/audio-understanding`
- `POST /tasks/media-convert`
- `POST /train`
- `GET /voices`
- `GET /jobs`
- `GET /health`
- `GET /runtime/info`
- `GET /capabilities`

Agent expectation:

- Follow the existing endpoint grouping when adding new functionality.
- Do not scatter related task logic across arbitrary files.

## Async Job Pattern

Use the existing queue model for long-running local work.

- Local inference should usually return a `job_id` and be polled through `/jobs`
- Cloud responses may return directly, then create instant jobs for unified frontend display
- Respect current serial or bounded concurrency behavior for local inference workloads

Do not:

- Bypass the queue for long-running local tasks
- Add UI-only task states that diverge from backend job states without strong reason

## Logging Rules

Development mode:

- Prefer stdout and stderr only
- Do not add unnecessary file logging in development

Packaged production mode:

- Use the existing log file flow
- Respect `LOGS_DIR`
- Keep backend, Electron, and frontend logs consistent with current structure

Typical files:

- `logs/backend.log`
- `logs/electron.log`
- `logs/frontend.log`

## Packaging Rules

- `pnpm run dist` builds frontend output before packaging Electron.
- Packaging logic lives in `scripts/dist.sh` and `electron-builder` config in `package.json`.
- Platform-specific embedded runtimes are copied from `runtime/mac/python/`, `runtime/mac/bin/`, `runtime/win/python/`, and `runtime/win/bin/`.
- Checkpoint packaging is not something to assume; verify actual builder config and runtime resolution rules before claiming a model is bundled.

Agent packaging checklist:

- Confirm frontend build output path
- Confirm resource inclusion in `package.json`
- Confirm runtime path resolution in `main.js` and backend config
- Confirm whether checkpoints resolve from bundled resources, project directory, or user data

## Model And Asset Rules

- Keep large binary assets out of normal git history unless already tracked intentionally.
- Use the repo's existing HuggingFace-based pattern for large assets and checkpoints.
- Store model metadata in the expected project structure instead of inventing parallel config files.

Voice model structure:

```text
models/
  voices/{voice_id}/
    meta.json
    model.pth or model.onnx
    optional index files
```

## Frontend Design And Engineering Rules

- Preserve the existing design system and UI patterns unless the task is explicitly a redesign.
- Avoid turning the UI into generic template-like output.
- Keep feature logic inside hooks and focused components.
- Reuse shared controls such as selectors, provider rows, and output rows when possible.

## Editing Rules For Agents

- Read the code path before proposing architectural changes.
- Prefer repository-consistent, mainstream, production-grade solutions.
- Avoid niche, temporary, or workaround-heavy solutions when a direct fix is feasible.
- Make the smallest coherent change that solves the user problem end-to-end.
- Do not revert unrelated user changes.
- If the worktree has unrelated modifications, leave them alone.
- If you detect unexpected conflicting changes in files you are editing, stop and resolve that conflict explicitly before continuing.

## Testing And Verification Rules

- Prefer targeted verification close to the change first.
- Use pytest for backend logic and mocks.
- Use smoke tests for broader runtime validation when relevant.
- For packaging changes, verify scripts and path assumptions rather than guessing.
- If full verification is not run, state exactly what was skipped.

Testing expectations:

- Tests should not require live external services unless the task explicitly demands integration work.
- Prefer mocks for cloud API tests.
- Keep CI-friendly behavior in mind.

## Operational Constraints

- CORS is intentionally open in this desktop-oriented architecture.
- Production frontend is static; do not introduce assumptions that require a live Next.js server in packaged mode.
- Long-running subprocesses must handle stdout and stderr explicitly to avoid pipe inheritance issues and deadlocks.

Subprocess rule:

- Be careful when nesting subprocesses under captured pipes.
- Avoid designs where a persistent child inherits a captured stderr pipe from an ancestor process.

## Release And Distribution

- Release workflows are tag-centric.
- Packaged artifacts and large binary delivery should follow the existing repository strategy.
- Do not move release assets into git as a shortcut.

## Agent Workflow

When working in this repository:

1. Inspect the relevant code path first.
2. Check whether `CLAUDE.md` or `README.md` adds a constraint not obvious from code.
3. Prefer extending existing modules over creating parallel ones.
4. Verify targeted behavior.
5. Report what changed, what was verified, and what remains unverified.

## Default Bias

This repository favors:

- mainstream tools
- explicit execution paths
- clear setup stages
- manifest-driven runtime configuration
- queue-based handling of long-running local tasks
- packaging-aware path management

This repository rejects by default:

- hidden runtime installation
- silent fallback behavior
- duplicated architecture paths
- temporary hacks that weaken packaging or runtime consistency
