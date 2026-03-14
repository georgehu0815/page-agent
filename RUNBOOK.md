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
npm run build:ext         # production build → packages/extension/.output/chrome-mv3/
npm run zip               # build + zip      → packages/extension/.output/page-agent-ext-<version>-chrome.zip
```

Load the unpacked folder in Chrome at `chrome://extensions/` → *Load unpacked* → select `.output/chrome-mv3/`.

### Extension dev mode (hot reload)

```bash
npm run dev:ext
```

Starts WXT in watch mode. Load `.output/chrome-mv3-dev/` in Chrome once; it reloads automatically on code changes.

---

## 8. Build and deploy the Microsoft Edge extension

### Prerequisites

| Requirement | Notes |
|---|---|
| Microsoft Edge | Version 79+ (Chromium-based, MV3 support) |
| Azure CLI authenticated | Run `az login` once — the extension uses Azure OpenAI Managed Identity |

---

### 8a. Build

```bash
# From repo root — builds libraries first, then the Edge extension
npm run build:libs
npm run build:edge --workspace=@page-agent/ext
```

Output lands in `packages/extension/.output/edge-mv3/`.

```
.output/edge-mv3/
├─ manifest.json            ← MV3 manifest (browser: "edge")
├─ background.js            ← service worker
├─ sidepanel.html           ← side panel UI entry
├─ chunks/                  ← React UI bundle
├─ content-scripts/         ← page interaction script
├─ main-world.js            ← injected into page context
├─ assets/                  ← CSS + icons
└─ _locales/                ← i18n (en, zh_CN)
```

---

### 8b. Load unpacked in Edge (dev / testing)

1. Open Edge and navigate to `edge://extensions/`
2. Enable **Developer mode** (toggle in the bottom-left corner)
3. Click **Load unpacked**
4. Select the folder:
   ```
   packages/extension/.output/edge-mv3/
   ```
5. The extension appears in the toolbar. Pin it for easy access.

> **Tip:** Every time you rebuild (`npm run build:edge --workspace=@page-agent/ext`), click the
> refresh icon on the extension card in `edge://extensions/` to pick up the new build.

---

### 8c. Dev mode (hot reload)

```bash
npm run dev:edge --workspace=@page-agent/ext
```

WXT launches Edge using the profile stored in `.wxt/edge-data/` and reloads the extension
automatically on every file save. No need to manually refresh in `edge://extensions/`.

**First launch only:** Edge will open with the extension already installed in the dedicated
WXT profile. Keep this Edge window open while developing.

---

### 8d. Run the extension tests

```bash
npm test --workspace=@page-agent/ext
```

Runs the Vitest suite covering:
- `AZURE_CONFIG` is empty `{}` (triggers `AzureOpenAIClient` automatically — no API key needed)
- `isTestingEndpoint()` URL matching and trailing-slash normalisation
- `migrateLegacyEndpoint()` auto-migration of old demo URLs to the Azure default

---

### 8e. Zip for distribution / store submission

```bash
npm run zip:edge --workspace=@page-agent/ext
```

Produces:
```
packages/extension/.output/page-agent-ext-<version>-edge.zip
```

This zip is ready to upload to the **Microsoft Edge Add-ons store**.

---

### 8f. Submit to the Microsoft Edge Add-ons store

1. Sign in at [https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview](https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview)
2. Click **Create new extension**
3. Upload `page-agent-ext-<version>-edge.zip`
4. Fill in the store listing:
   - **Name:** Edge Page Agent Ext
   - **Short description:** AI-powered browser automation assistant. Control web pages with natural language.
   - **Category:** Productivity
   - **Privacy policy URL:** `https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md`
5. Submit for certification (typically 1–3 business days)

---

### 8g. LLM configuration in the extension

The extension defaults to **Azure OpenAI with Managed Identity** — no API key is required.

| Scenario | What happens |
|---|---|
| No settings configured | Uses `AzureOpenAIClient` with the endpoint from `azure-openai-models.ts` |
| User fills in Base URL + API Key + Model in Settings panel | Switches to `OpenAIClient` (any OpenAI-compatible endpoint) |
| Legacy demo URL detected in saved settings | Auto-migrated to Azure default on next load |

For local dev the extension calls Azure using `AzureCliCredential`.
Run `az login` before launching the extension in dev mode.

---

### 8h. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Side panel blank / white | Build not refreshed after code change | Reload extension in `edge://extensions/` |
| "Authentication failed" error in panel | `az login` not run or token expired | Run `az login` and reload |
| "Network request failed" in panel | Azure endpoint unreachable or wrong managed identity | Check `azure-openai-models.ts` constants and network access |
| Extension not appearing after "Load unpacked" | Wrong folder selected | Select `.output/edge-mv3/` (not `edge-mv3-dev/`) |
| `wxt build` fails with TS errors | Stale library dist files | Run `npm run build:libs` first |

---

## 9. Lint

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
npm run dev:ext                                   # Chrome (hot reload)
npm run dev:edge --workspace=@page-agent/ext      # Edge (hot reload)

# Extension tests
npm test --workspace=@page-agent/ext

# Extension production build + zip
npm run build:edge --workspace=@page-agent/ext    # → .output/edge-mv3/
npm run zip:edge   --workspace=@page-agent/ext    # → .output/page-agent-ext-<v>-edge.zip

# Full production build
npm run build

# Stop
Ctrl + C

# Clean slate
npm run cleanup && npm run build:libs
```
