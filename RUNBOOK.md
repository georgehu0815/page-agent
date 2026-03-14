# Page Agent — Build & Run Guide

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | `^20.19`, `^22.13`, or `>=24` | `node --version` |
| npm | `>=10` | `npm --version` |
| Git | any | `git --version` |

---

## LLM Configuration — Azure OpenAI (default)

The default LLM backend is **Azure OpenAI with Managed Identity** — no API key required.
Authentication is handled automatically:

| Environment | Credential used | How to set up |
|---|---|---|
| **Local / dev** | `AzureCliCredential` | Run `az login` once |
| **Production** | `ManagedIdentityCredential` | Assign the managed identity to the Azure resource |

The endpoint, deployment name, API version, and managed identity client ID are configured in
`packages/llms/src/azure-openai-models.ts`:

```
AZURE_OPENAI_ENDPOINT   = https://datacopilothub8882317788.cognitiveservices.azure.com/
AZURE_OPENAI_DEPLOYMENT = gpt-5.2-chat
AZURE_OPENAI_API_VERSION = 2024-08-01-preview
AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID = c9427d44-98e2-406a-9527-f7fa7059f984
```

### Dev setup (one-time)

```bash
# Install the Azure CLI if not already installed
brew install azure-cli        # macOS
# or: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli

# Log in — credentials are cached locally
az login
```

After `az login`, `AzureCliCredential` will resolve tokens automatically.
No `.env` file or API key is needed.

### Using a different LLM (optional override)

To use any OpenAI-compatible endpoint instead, pass all three fields when constructing `PageAgent`:

```typescript
import { PageAgent } from 'page-agent'

const agent = new PageAgent({
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-...',
    model: 'gpt-4o',
})
```

When `baseURL` is present, the client falls back to the standard `OpenAIClient` and Azure is bypassed.

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

- Watches `packages/page-agent/src/` and rebuilds the IIFE bundle on change
- Serves `packages/page-agent/dist/iife/` on `http://localhost:5174/`

The IIFE demo always uses the built-in demo API endpoint by default.
Override it with a `.env` file in the repo root:

```bash
# .env  (repo root — not committed)
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL_NAME=gpt-4o
```

> Note: the IIFE demo does not use Managed Identity. It always requires
> `baseURL`/`apiKey`/`model` (from `.env` or the built-in demo endpoint).

---

## 5. Run the tests

```bash
npm test --workspace=@page-agent/llms
```

Runs the Vitest suite for the `@page-agent/llms` package, which covers
`AzureOpenAIClient` (credential selection, token caching, request format,
response parsing, error handling).

---

## 6. Build everything (libs + website)

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

## 7. Build the Chrome extension

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

## 8. Lint

```bash
npm run lint
```

Runs ESLint with TypeScript strict rules across all workspaces.

---

## 9. How to stop any running server

| Situation | How to stop |
|---|---|
| Terminal is in the foreground | Press `Ctrl + C` |
| Server is running in the background | `kill $(lsof -ti :5173)` (website) or `kill $(lsof -ti :5174)` (demo) |
| Kill all Vite dev servers at once | `pkill -f "vite"` |

---

## 10. Clean build artefacts

Remove all `dist/` folders across every package and start fresh:

```bash
npm run cleanup
```

After cleaning, run `npm run build:libs` before starting any dev server.

---

## Quick-reference cheat sheet

```bash
# First-time or after pulling
az login                                          # Authenticate with Azure CLI (dev only)
npm install
npm run build:libs

# Run tests
npm test --workspace=@page-agent/llms

# Day-to-day dev (website) — uses Azure OpenAI by default
npm start                                         # http://localhost:5173/page-agent/

# Day-to-day dev (demo IIFE script)
npm run dev:demo --workspace=page-agent           # http://localhost:5174/

# Extension dev
npm run dev:ext

# Full production build
npm run build

# Stop
Ctrl + C

# Clean slate
npm run cleanup && npm run build:libs
```
