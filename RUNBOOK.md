# Page Agent — Build & Run Guide

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | `^20.19`, `^22.13`, or `>=24` | `node --version` |
| npm | `>=10` | `npm --version` |
| Git | any | `git --version` |

---

## 1. Install dependencies

Run once after cloning, and again after pulling changes that modify `package.json`:

```bash
npm install
```

This installs all workspace dependencies and runs `husky` (git hooks) automatically.

---

## 2. Build the libraries

All packages under `packages/` must be built before the website or demo can run.
The build order is determined by the `workspaces` array in the root `package.json`
(topological order).

```bash
npm run build:libs
```

What this builds, in order:

| Package | Output |
|---|---|
| `@page-agent/page-controller` | `packages/page-controller/dist/` |
| `@page-agent/ui` | `packages/ui/dist/` |
| `@page-agent/llms` | `packages/llms/dist/` |
| `@page-agent/core` | `packages/core/dist/` |
| `page-agent` (ESM) | `packages/page-agent/dist/esm/` |
| `page-agent` (IIFE demo) | `packages/page-agent/dist/iife/` |

You only need to re-run `build:libs` when you change source code in any library
package. The website dev server does **not** hot-reload library changes automatically.

---

## 3. Run the website (dev server)

```bash
npm start
```

- Starts the Vite dev server for `@page-agent/website`
- Binds to `0.0.0.0` so it is reachable on the local network

**Output:**

```
VITE v7.x.x  ready in ~180ms

  ➜  Local:   http://localhost:5173/page-agent/
  ➜  Network: http://<your-ip>:5173/page-agent/
```

Open `http://localhost:5173/page-agent/` in your browser.

### Hot reload scope

| Changed file | Action needed |
|---|---|
| `packages/website/src/**` | Automatic — Vite HMR |
| `packages/*/src/**` (libraries) | Stop server → `npm run build:libs` → `npm start` |

---

## 4. Run the IIFE demo (standalone script mode)

Use this to develop or test `page-agent` as an embeddable `<script>` tag,
served on a separate port alongside the website.

```bash
npm run dev:demo --workspace=page-agent
```

        "start": "npm run dev --workspace=@page-agent/website",
        "dev:ext": "npm run dev -w @page-agent/ext",
        "dev:demo": "npm run dev:demo --workspace=page-agent",
        "build": "npm run build:libs && npm run build:website",
        "build:libs": "npm run build --workspaces --if-present",
        "build:website": "npm run build:website --workspace=@page-agent/website",
        "build:ext": "npm run build:libs && npm run zip -w @page-agent/ext",

- Watches `packages/page-agent/src/` and rebuilds the IIFE bundle on change
- Serves `packages/page-agent/dist/iife/` on `http://localhost:5174/`

**Optional — configure your own LLM** by creating a `.env` file in the repo root:

```bash
# .env  (repo root — not committed)
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL_NAME=gpt-4o
```

If `.env` is absent the demo falls back to the built-in free testing API endpoint.

---

## 5. Build everything (libs + website)

Produces production-optimised output for all packages:

```bash
npm run build
```

This runs `build:libs` first, then `build:website`. The website output lands in
`packages/website/dist/`.

### Preview the production website build

```bash
npm run preview --workspace=@page-agent/website
```

Serves the production build locally at `http://localhost:4173/page-agent/`.

---

## 6. Build the Chrome extension

```bash
npm run build:ext
```

This runs `build:libs` first, then zips the extension into
`packages/extension/.output/`.
Load the unpacked folder in Chrome at `chrome://extensions/` → *Load unpacked*.

### Extension dev mode (hot reload)

```bash
npm run dev:ext
```

Starts WXT in watch mode. Load the `.output/chrome-mv3-dev/` folder in Chrome once;
it reloads automatically on code changes.

---

## 7. Lint

```bash
npm run lint
```

Runs ESLint with TypeScript strict rules across all workspaces.

---

## 8. How to stop any running server

| Situation | How to stop |
|---|---|
| Terminal is in the foreground | Press `Ctrl + C` |
| Server is running in the background | `kill $(lsof -ti :5173)` (website) or `kill $(lsof -ti :5174)` (demo) |
| Kill all Vite dev servers at once | `pkill -f "vite"` |

---

## 9. Clean build artefacts

Remove all `dist/` folders across every package and start fresh:

```bash
npm run cleanup
```

After cleaning, run `npm run build:libs` before starting any dev server.

---

## Quick-reference cheat sheet

```bash
# First-time or after pulling
npm install
npm run build:libs

# Day-to-day dev (website)
npm start                        # http://localhost:5173/page-agent/

# Day-to-day dev (demo IIFE script)
npm run dev:demo --workspace=page-agent   # http://localhost:5174/

# Extension dev
npm run dev:ext

# Full production build
npm run build

# Stop
Ctrl + C

# Clean slate
npm run cleanup && npm run build:libs
```
