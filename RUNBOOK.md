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

## 8. Microsoft Edge Extension — Full Setup Guide

This section covers everything needed to go from a fresh clone to a running Edge extension,
including Azure AD app registration, OAuth2 token flow, developer mode, production build,
and store submission.

---

### 8.0 How authentication works in the extension

The extension calls **Azure OpenAI** using an OAuth2 Bearer token obtained from Azure AD via
`chrome.identity.launchWebAuthFlow`. This is different from the Node.js managed identity approach:

```
User clicks extension icon
        ↓
Side panel opens
        ↓
Agent needs a token (first call or token expired)
        ↓
chrome.identity.launchWebAuthFlow → Azure AD login popup
        ↓
Azure AD returns access_token in the URL fragment
        ↓
Token cached in memory for up to (expiry – 5 min)
        ↓
Token sent as  Authorization: Bearer <token>  and  api-key: <token>
        ↓
Azure OpenAI returns LLM response
```

> **No API key is stored.** Tokens are held in extension memory only and expire automatically.

---

### 8.1 Prerequisites

| Requirement | Version / Notes |
|---|---|
| Node.js | `^20.19`, `^22.13`, or `>=24` |
| npm | `>=10` |
| Microsoft Edge | Version 79+ (Chromium-based, Manifest V3 support) |
| Azure subscription | Access to the Azure OpenAI resource |
| Azure AD permissions | Ability to register an app or modify an existing registration |

---

### 8.2 Azure AD app registration (one-time setup)

The extension uses **OAuth2 Authorization Code + PKCE** flow — this is the modern,
recommended approach for browser extensions and requires **no special flags** in Azure AD.
It does NOT require implicit grant to be enabled.

> If you see `AADSTS700051: response_type 'token' is not enabled`, you are using the old
> implicit flow. This setup guide uses PKCE which avoids that error entirely.

#### Step 1 — Create a new app registration

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Fill in:
   - **Name:** `page-agent-edge-ext`
   - **Supported account types:** Accounts in this organizational directory only
   - **Redirect URI:** leave blank — added in Step 3
3. Click **Register**
4. Copy the **Application (client) ID** — paste it into `AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID` in `packages/llms/src/azure-openai-models.ts`

#### Step 2 — Add the SPA platform (enables PKCE)

In the new app registration → **Authentication** tab:

1. Click **Add a platform** → choose **Single-page application (SPA)**
2. Leave the redirect URI blank for now
3. Click **Configure**

> **Why SPA and not Web?** The SPA platform type enables PKCE authorization code flow
> without a client secret. The Web platform requires a secret (not suitable for extensions).
> Do NOT enable "Implicit grant" — the PKCE flow does not need it.

#### Step 3 — Add the extension redirect URI

The redirect URI is unique per extension ID.

**Get the redirect URI:**

After loading the extension in Edge at least once (see §8.4):

1. Go to `edge://extensions/`
2. Click **Inspect views: sidepanel** on the extension card
3. In the DevTools console, run:
   ```javascript
   chrome.identity.getRedirectURL()
   ```
4. Copy the result — it looks like:
   ```
   https://mgffbdlbkhpbeijgjfgmekanmlaldmah.chromiumapp.org/
   ```

**Add it to the SPA platform:**

1. Azure portal → App registration → **Authentication** → under **Single-page application**, click **Add URI**
2. Paste the exact URL
3. Click **Save**

> The dev build (`.output/edge-mv3-dev/`) and production build (`.output/edge-mv3/`) have
> different extension IDs. Add both redirect URIs if you use both.

#### Step 4 — Grant API permissions

1. App registration → **API permissions** → **Add a permission**
2. Select **Azure Cognitive Services**
3. Choose **Delegated permissions** → check `user_impersonation`
4. Click **Add permissions**
5. Click **Grant admin consent** (requires Global Admin or Application Admin role)

---

### 8.3 Configure the constants

Verify or update the Azure OpenAI constants in
`packages/llms/src/azure-openai-models.ts`:

```typescript
export const AZURE_OPENAI_ENDPOINT   = 'https://<your-resource>.cognitiveservices.azure.com/'
export const AZURE_OPENAI_DEPLOYMENT = 'gpt-5.2-chat'       // your deployment name
export const AZURE_OPENAI_API_VERSION = '2024-08-01-preview'
export const AZURE_OPENAI_SCOPE      = 'https://cognitiveservices.azure.com/.default'
export const AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID = '<your-app-registration-client-id>'
```

If you changed the tenant from `common`, also update the stub in
`packages/extension/src/azure-identity-browser.ts`:

```typescript
const AAD_TENANT = 'your-tenant-id'   // e.g. 'contoso.onmicrosoft.com' or a GUID
```

After editing either file, rebuild:

```bash
npm run build:libs
```

---

### 8.4 First-time build and load in Edge

```bash
# 1. Install all dependencies (once after cloning)
npm install

# 2. Build all library packages
npm run build:libs

# 3. Build the Edge extension
npm run build:edge --workspace=@page-agent/ext
```

Output folder: `packages/extension/.output/edge-mv3/`

```
.output/edge-mv3/
├─ manifest.json              ← MV3 manifest with identity permission
├─ background.js              ← service worker
├─ sidepanel.html             ← side panel UI entry point
├─ chunks/sidepanel-*.js      ← React UI bundle (azure-identity aliased to browser stub)
├─ content-scripts/content.js ← injected into every tab
├─ main-world.js              ← injected into page main world context
├─ assets/                    ← CSS + icons
└─ _locales/en, zh_CN/        ← i18n message files
```

**Load in Edge:**

1. Open Edge → navigate to `edge://extensions/`
2. Toggle **Developer mode** on (bottom-left)
3. Click **Load unpacked**
4. Select `packages/extension/.output/edge-mv3/`
5. The **Edge Page Agent Ext** card appears — click the pin icon to pin it to the toolbar

---

### 8.5 First-time sign-in (OAuth2 flow)

1. Click the extension icon in the Edge toolbar
2. The side panel opens
3. Type any task and press Enter (or just wait for the first LLM call)
4. A **Microsoft login popup** appears — sign in with your organizational account
5. If prompted, consent to the permissions (`Azure Cognitive Services / user_impersonation`)
6. The popup closes automatically and the token is cached
7. The agent executes your task using Azure OpenAI

> The login popup only appears when the token is absent or expired (after ~55 minutes by default).
> Subsequent calls within the same browser session are silent.

---

### 8.6 Developer mode (hot reload)

For iterative development — WXT watches source files and reloads the extension automatically:

```bash
npm run dev:edge --workspace=@page-agent/ext
```

What happens:
- WXT builds a dev bundle into `.output/edge-mv3-dev/` (unminified, with source maps)
- WXT launches Edge using the profile stored in `.wxt/edge-data/`
- The extension is pre-installed in that profile
- Every time you save a source file, WXT rebuilds and reloads the extension in Edge
- The dev server runs at `http://localhost:3000`

**First launch:** Edge opens a new window. If it shows "restore previous session", dismiss it.

**Reopen Edge if closed:**
```
# Press in the terminal running dev:edge
o + Enter
```

**Stop:**
```
Ctrl + C
```

> The dev build has a different extension ID from the production build.
> Its redirect URI (`chrome.identity.getRedirectURL()`) must be added to the Azure AD
> app registration separately (see §8.2 Step 3).

---

### 8.7 Run the extension tests

```bash
npm test --workspace=@page-agent/ext
```

Expected output:

```
 RUN  v4.x.x

 ✓ src/agent/constants.test.ts (9 tests)
   ✓ AZURE_CONFIG is empty {} (triggers AzureOpenAIClient automatically)
   ✓ isTestingEndpoint — matches legacy URL
   ✓ isTestingEndpoint — matches with trailing slash
   ✓ isTestingEndpoint — returns false for arbitrary URL
   ✓ isTestingEndpoint — returns false for empty string
   ✓ migrateLegacyEndpoint — returns AZURE_CONFIG for legacy URL
   ✓ migrateLegacyEndpoint — migrates with trailing slash
   ✓ migrateLegacyEndpoint — passthrough for non-legacy URL
   ✓ migrateLegacyEndpoint — passthrough when baseURL undefined

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

---

### 8.8 Using a different LLM (optional)

If you want to bypass Azure and use any OpenAI-compatible endpoint:

1. Click the **gear icon** (⚙) in the extension side panel to open Settings
2. Fill in all three fields:
   - **Base URL** — e.g. `https://api.openai.com/v1`
   - **API Key** — your key
   - **Model** — e.g. `gpt-4o`
3. Click **Save**

When all three fields are present, the extension uses `OpenAIClient` directly and skips
the Azure OAuth2 flow entirely. Clear the fields to revert to Azure.

---

### 8.9 Production build and zip

```bash
npm run zip:edge --workspace=@page-agent/ext
```

Produces:
```
packages/extension/.output/page-agent-ext-1.5.7-edge.zip   (~363 KB)
```

This zip contains the production-minified bundle and is ready to sideload or submit to the store.

**Sideload the zip** (alternative to Load unpacked):

1. `edge://extensions/` → Developer mode on
2. Drag and drop the `.zip` file onto the page
3. Edge installs it as a permanent extension (survives browser restarts)

---

### 8.10 Submit to the Microsoft Edge Add-ons store

1. Sign in at the [Microsoft Partner Center](https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview)
2. Click **Create new extension**
3. Upload `page-agent-ext-<version>-edge.zip`
4. Complete the listing:

| Field | Value |
|---|---|
| Name | Edge Page Agent Ext |
| Short description | AI-powered browser automation assistant. Control web pages with natural language. |
| Category | Productivity |
| Privacy policy URL | `https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md` |

5. Submit — certification typically takes 1–3 business days

> The store build has yet another extension ID. Add its redirect URI to the Azure AD
> app registration before publishing (users won't be able to sign in without it).

---

### 8.11 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `AADSTS700051: response_type 'token' is not enabled` | Old implicit flow code still running | Reload the extension after the latest build — PKCE uses `response_type=code` |
| Login popup never appears | `identity` permission missing | Check `manifest.json` contains `"identity"` in permissions |
| Login popup appears then fails | Redirect URI not whitelisted | Run `chrome.identity.getRedirectURL()` in DevTools console, add URI to the SPA platform in Azure AD |
| "No authorization code in redirect response" | Platform type wrong | Ensure the Azure AD app uses **SPA** platform, not Web or Mobile |
| "Azure AD token exchange failed (400)" | PKCE verifier mismatch or redirect URI wrong | Reload and retry; verify redirect URI exactly matches what's registered |
| "Azure AD login failed" | User cancelled or AAD unreachable | Sign in again; check network / AAD tenant availability |
| "Authentication failed" (LLM error) | Token sent but Azure rejected it | Check API permissions, grant admin consent, verify resource RBAC |
| "Network request failed" | Azure OpenAI endpoint wrong or unreachable | Verify `AZURE_OPENAI_ENDPOINT` in `azure-openai-models.ts` |
| Side panel blank / white | Stale build after source change | Reload extension in `edge://extensions/` or restart `dev:edge` |
| Extension not listed after Load unpacked | Wrong folder | Select `.output/edge-mv3/` (production) or `.output/edge-mv3-dev/` (dev) |
| `wxt build` TypeScript errors | Stale library dist files | Run `npm run build:libs` first |
| Different ID each reinstall | Extension not pinned from a stable source | Always load from the same folder path; don't delete and re-add |

---

## 9. Lint

```bash
npm run lint
```

Runs ESLint with TypeScript strict rules across all workspaces.

---

## 10. How to stop any running server

| Situation | How to stop |
|---|---|
| Terminal is in the foreground | Press `Ctrl + C` |
| Server is running in the background | `kill $(lsof -ti :5173)` (website) or `kill $(lsof -ti :5174)` (demo) |
| Kill all Vite dev servers at once | `pkill -f "vite"` |

---

## 11. Clean build artefacts

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
