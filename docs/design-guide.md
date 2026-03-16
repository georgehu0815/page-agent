---
title: "Page Agent — Design Guide"
author: "Engineering Team"
date: "2026-03-15"
---

# Page Agent Design Guide

## Overview

Page Agent is a browser AI agent that interprets a user's natural-language task, observes the live DOM, reasons via a large language model (Azure OpenAI GPT), and executes browser actions — click, type, scroll, navigate — in a ReAct (Reason + Act) loop until the task is complete.

The system is structured as a monorepo with five core packages:

| Package | Purpose |
|---|---|
| `@page-agent/core` | Agent loop, tool dispatch, event model |
| `@page-agent/llms` | LLM clients (OpenAI + Azure OpenAI) |
| `@page-agent/page-controller` | DOM observation and action execution |
| `@page-agent/page-agent` | Standalone (non-extension) entry point |
| `@page-agent/ext` | Microsoft Edge extension (MV3) |

---

## Package Dependency Graph

```
@page-agent/ext  (Edge Extension)
    └── @page-agent/core
            ├── @page-agent/llms
            └── @page-agent/page-controller

page-agent  (standalone wrapper)
    └── @page-agent/core
            ├── @page-agent/llms
            └── @page-agent/page-controller
```

---

## 1. Core Package — `@page-agent/core`

### 1.1 `PageAgentCore`

**File:** `packages/core/src/PageAgentCore.ts`
**Extends:** `EventTarget`

The central orchestrator. Runs the ReAct step loop: observe the browser, invoke the LLM, execute the chosen tool, record history, repeat.

#### Constructor

```typescript
constructor(config: AgentConfig & { pageController: PageController })
```

#### Public Properties

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique agent instance ID |
| `config` | `PageAgentCoreConfig` | Full resolved config with defaults |
| `tools` | `Map<string, PageAgentTool>` | Available tools (built-in + custom) |
| `pageController` | `PageController` | DOM observation and action interface |
| `task` | `string` | Current natural-language task |
| `taskId` | `string` | Unique ID per `execute()` call |
| `history` | `HistoricalEvent[]` | Full event stream (steps, errors, retries) |
| `disposed` | `boolean` | True after `dispose()` is called |
| `status` | `AgentStatus` | `idle \| running \| completed \| error` |

#### Public Methods

```typescript
// Start executing a task. Runs the ReAct loop until done or maxSteps.
async execute(task: string): Promise<ExecutionResult>

// Signal the running loop to stop after the current step.
stop(): void

// Release resources, cancel pending operations, emit 'dispose' event.
dispose(): void

// Append an observation string that will be included in the next LLM prompt.
pushObservation(content: string): void
```

#### Events Emitted

| Event | Payload | When |
|---|---|---|
| `statuschange` | `{ status: AgentStatus }` | Status transitions |
| `historychange` | `{ history: HistoricalEvent[] }` | History updated |
| `activity` | `AgentActivity` | Real-time step feedback |
| `dispose` | `{ reason?: string }` | Cleanup triggered |

#### Step Loop — Detailed Flow

```
execute(task)
  │
  ├─ 1. Reset state — clear history, show mask, init abort controller
  │
  ├─ 2. onBeforeTask hook
  │
  └─ LOOP (step = 0 .. maxSteps)
       │
       ├─ onBeforeStep hook
       │
       ├─ OBSERVE
       │    ├─ getBrowserState() → { url, title, content }
       │    ├─ detect URL change → pushObservation("Page navigated to …")
       │    ├─ check accumulated wait time warning
       │    └─ emit activity { type: 'thinking' }
       │
       ├─ THINK — LLM Invocation
       │    ├─ assembleUserPrompt() — history + browser state + observations
       │    ├─ invoke LLM with MacroTool (enforces reflection schema)
       │    │    MacroTool input: { evaluation_previous_goal, memory,
       │    │                       next_goal, action }
       │    └─ parse tool name + args from response
       │
       ├─ ACT — Tool Execution
       │    ├─ emit activity { type: 'executing', tool, input }
       │    ├─ tool.execute.call(this, args)
       │    ├─ track wait time for 'wait' tool
       │    └─ emit activity { type: 'executed', tool, output, duration }
       │
       ├─ record AgentStepEvent to history
       ├─ onAfterStep hook
       │
       ├─ if tool == 'done' → break loop
       └─ if error → record AgentErrorEvent, break loop

  ├─ onAfterTask hook
  ├─ hide mask, clean highlights
  └─ return ExecutionResult { success, data, history }
```

---

## 2. LLM Package — `@page-agent/llms`

### 2.1 `OpenAIClient`

**File:** `packages/llms/src/OpenAIClient.ts`
**Implements:** `LLMClient`

Generic OpenAI-compatible client. Subclassed by `AzureOpenAIClient`.

#### Constructor

```typescript
constructor(config: Required<LLMConfig>)
```

#### Public Methods

```typescript
async invoke(
  messages: Message[],
  tools: Record<string, Tool>,
  abortSignal?: AbortSignal,
  options?: InvokeOptions
): Promise<InvokeResult>
```

#### Protected Methods

```typescript
// Override in subclasses to change URL, headers, or auth.
protected async fetchCompletion(
  requestBody: Record<string, unknown>,
  abortSignal?: AbortSignal
): Promise<Response>
```

#### Error Handling in `invoke()`

```
fetchCompletion() throws
  └─ catch → InvokeError(NETWORK_ERROR, "Network request failed: <cause>")

response.status 401/403
  └─ InvokeError(AUTH_ERROR, "Authentication failed: …")

response.status 429
  └─ InvokeError(RATE_LIMIT, "Rate limit exceeded: …")

response.status >= 500
  └─ InvokeError(SERVER_ERROR, "Server error: …")
```

---

### 2.2 `AzureOpenAIClient`

**File:** `packages/llms/src/OpenAIClient.ts`
**Extends:** `OpenAIClient`

Azure-specific subclass. Overrides `fetchCompletion` to acquire a Bearer token from Azure AD before each request (with caching).

#### Constructor

```typescript
constructor(config?: AzureOpenAIConfig)
// { temperature?: number, maxRetries?: number }
```

#### Key Private Fields

| Field | Type | Description |
|---|---|---|
| `credential` | `AzureCliCredential \| ManagedIdentityCredential` | Selected by `NODE_ENV` |
| `cachedToken` | `string \| null` | Cached Bearer token |
| `tokenExpiry` | `number` | Expiry timestamp (ms, with 5-min buffer) |

#### Credential Selection

```typescript
if (process.env.NODE_ENV === 'production') {
  // Extension build → browser OAuth2 PKCE shim
  this.credential = new ManagedIdentityCredential(AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID)
} else {
  // Local dev → Azure CLI credential (az login)
  this.credential = new AzureCliCredential()
}
```

#### `fetchCompletion` override

```typescript
protected override async fetchCompletion(requestBody, abortSignal) {
  const token = await this.getToken()   // refresh if expired
  const url = `${AZURE_OPENAI_ENDPOINT}openai/deployments/${AZURE_OPENAI_DEPLOYMENT}`
            + `/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`

  return this.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'api-key': token,          // Azure accepts both headers
    },
    body: JSON.stringify(requestBody),
    signal: abortSignal,
  })
}
```

---

### 2.3 `LLM`

**File:** `packages/llms/src/index.ts`
**Extends:** `EventTarget`

Facade over the underlying client. Adds retry logic and emits events.

#### Constructor

```typescript
constructor(config: LLMConfig = {})
```

`parseLLMConfig()` selects `AzureOpenAIClient` (default) unless `baseURL + apiKey + model` are all set, in which case it uses `OpenAIClient`.

#### Public Methods

```typescript
async invoke(
  messages: Message[],
  tools: Record<string, Tool>,
  abortSignal: AbortSignal,
  options?: InvokeOptions
): Promise<InvokeResult>
```

#### Events

| Event | Payload | When |
|---|---|---|
| `retry` | `{ attempt, maxAttempts }` | LLM retry attempt |
| `error` | `{ error: Error }` | Non-retriable error |

---

### 2.4 Azure Identity Browser Shim

**File:** `packages/extension/src/azure-identity-browser.ts`

Replaces `@azure/identity` (Node.js only) at build time via Vite alias. Implements OAuth2 Authorization Code + PKCE using `chrome.identity.launchWebAuthFlow`.

#### Constants

```typescript
const BROWSER_CLIENT_ID = '5e10fe82-09d3-4404-88e5-2f8e98ff7b67' // page-agent-edge-ext
const AAD_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47'         // microsoft.com tenant
```

#### PKCE Flow — Step by Step

```
1. generatePKCE()
     verifier = crypto.randomUUID() + crypto.randomUUID()
     challenge = base64url(SHA-256(verifier))

2. Build authorize URL:
     https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
       ?client_id=BROWSER_CLIENT_ID
       &response_type=code
       &redirect_uri=chrome.identity.getRedirectURL()
       &scope=https://cognitiveservices.azure.com/.default
       &code_challenge={challenge}
       &code_challenge_method=S256

3. chrome.identity.launchWebAuthFlow({ url, interactive: true })
     → Azure AD login popup
     → redirect back with ?code=…

4. Check for error params in redirect URL (invalid_client, access_denied, etc.)

5. POST to /oauth2/v2.0/token:
     grant_type=authorization_code
     client_id=BROWSER_CLIENT_ID
     code={code}
     redirect_uri={same as step 2}
     code_verifier={verifier from step 1}

6. Return { token: access_token, expiresOnTimestamp }
```

#### Exported Classes

**`AzureCliCredential`**

```typescript
class AzureCliCredential {
  getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number }>
}
```

**`ManagedIdentityCredential`**

```typescript
class ManagedIdentityCredential {
  constructor(clientId?: string)
  getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number }>
}
```

Both delegate to `acquireToken()` internally. The `clientId` parameter is accepted for interface compatibility but the shim always uses `BROWSER_CLIENT_ID`.

---

## 3. Page Controller Package — `@page-agent/page-controller`

### 3.1 `PageController`

**File:** `packages/page-controller/src/PageController.ts`
**Extends:** `EventTarget`

Runs inside the browser page context. Owns the DOM tree snapshot and executes actions directly on DOM elements.

#### Constructor

```typescript
constructor(config: PageControllerConfig = {})
// PageControllerConfig extends DomConfig + { enableMask?: boolean }
```

#### Public Methods

```typescript
// State queries
async getCurrentUrl(): Promise<string>
async getLastUpdateTime(): Promise<number>
async getBrowserState(): Promise<BrowserState>

// DOM snapshot
async updateTree(): Promise<string>
async cleanUpHighlights(): Promise<void>

// Element actions
async clickElement(index: number): Promise<ActionResult>
async inputText(index: number, text: string): Promise<ActionResult>
async selectOption(index: number, optionText: string): Promise<ActionResult>

// Scroll
async scroll(options: {
  down: boolean
  numPages: number
  pixels?: number
  index?: number
}): Promise<ActionResult>

async scrollHorizontally(options: {
  right: boolean
  pixels: number
  index?: number
}): Promise<ActionResult>

// Script execution (experimental)
async executeJavascript(script: string): Promise<ActionResult>

// Visual mask overlay
async showMask(): Promise<void>
async hideMask(): Promise<void>

dispose(): void
```

#### Key Private Fields

| Field | Type | Description |
|---|---|---|
| `flatTree` | `FlatDomTree \| null` | Most recent DOM snapshot |
| `selectorMap` | `Map<number, InteractiveElementDomNode>` | Index → element |
| `elementTextMap` | `Map<number, string>` | Index → label text |
| `simplifiedHTML` | `string` | LLM-ready text representation |
| `lastTimeUpdate` | `number` | Snapshot timestamp |
| `isIndexed` | `boolean` | Whether tree has been indexed |
| `mask` | `SimulatorMask \| null` | Visual overlay during execution |

#### Events

| Event | When |
|---|---|
| `beforeUpdate` | Before DOM tree rebuild |
| `afterUpdate` | After DOM tree rebuild |

---

### 3.2 DOM Tree Functions

**File:** `packages/page-controller/src/dom/index.ts`

#### `getFlatTree(config: DomConfig): FlatDomTree`

Calls `domTree()` in `dom_tree/index.js` to traverse the live DOM and returns a flat map of all nodes.

- Applies interactive element blacklist/whitelist
- Marks newly appeared interactive elements (`isNew = true`)
- Returns `{ rootId, map }` where `map` is `Record<string, DomNode>`

#### `flatTreeToString(flatTree, includeAttributes?): string`

Converts the flat tree to an LLM-readable text format:

```
[0]<button role=button>Submit />
[1]<input type=text placeholder=Search />
    Search results
[2]<a >Home />
```

- Interactive elements: `[index]<tagName attr=val>text />`
- New elements: `*[index]<…>`
- Indentation reflects DOM depth
- Duplicate attribute values are de-duplicated
- `role` attribute removed when it matches `tagName`

#### `getSelectorMap(flatTree): Map<number, InteractiveElementDomNode>`

Maps highlight index to element node — used by `clickElement`, `inputText`, etc.

#### `cleanUpHighlights(): void`

Removes all visual element highlight overlays. Called on navigation, `hashchange`, `popstate`, and `beforeunload`.

---

### 3.3 `buildDomTree` (internal — `dom_tree/index.js`)

Recursive DOM traversal. Key behaviors:

- **Interactive detection:** `<button>`, `<input>`, `<select>`, `<a>`, `role=button`, `tabindex`, `contenteditable`, etc.
- **Cross-origin iframes:** Access exceptions are silently swallowed (security boundary).
- **Shadow DOM:** Traverses open shadow roots.
- **Viewport filtering:** Controlled by `viewportExpansion` (-1 = full page, 0 = visible only).
- **Highlight overlay:** Injects colored labels over each interactive element.

---

## 4. Extension Package — `@page-agent/ext`

### 4.1 `MultiPageAgent`

**File:** `packages/extension/src/agent/MultiPageAgent.ts`
**Extends:** `PageAgentCore`

Extension entry point. Wires together `TabsController`, `RemotePageController`, and custom tab tools.

#### Constructor

```typescript
constructor(config: AgentConfig & { includeInitialTab?: boolean })
```

#### Initialization Steps

```
1. new TabsController()
2. new RemotePageController(tabsController)
3. createTabTools(tabsController)    // open_new_tab, switch_tab, close_tab, etc.
4. Detect navigator.language → set system prompt language
5. Start heartbeat interval (detects side-panel close)
6. super({ ...config, pageController, customTools, customSystemPrompt })
```

#### Lifecycle Hooks

| Hook | Action |
|---|---|
| `onBeforeTask` | `tabsController.init(task, includeInitialTab)` |
| `onAfterTask` | Stop heartbeat, `tabsController.dispose()` |
| `onBeforeStep` | Start heartbeat timer |
| `onDispose` | Stop heartbeat, dispose tabs controller |

---

### 4.2 `TabsController`

**File:** `packages/extension/src/agent/TabsController.ts`
**Extends:** `EventTarget`

Manages the set of browser tabs the agent is allowed to control.

#### Constructor

```typescript
constructor() // stateless until init()
```

#### Public Properties

| Property | Type | Description |
|---|---|---|
| `currentTabId` | `number \| null` | Currently focused tab |
| `tabs` | `TabMeta[]` | All tracked tab metadata |
| `initialTabId` | `number \| null` | Tab that was active when task started |
| `tabGroupId` | `number \| null` | Chrome tab group for agent-created tabs |
| `task` | `string` | Task description (used in group title) |
| `windowId` | `number \| null` | Browser window ID |

#### Public Methods

```typescript
async init(task: string, includeInitialTab?: boolean): Promise<void>
async openNewTab(url: string): Promise<string>
async switchToTab(tabId: number): Promise<string>
async closeTab(tabId: number): Promise<string>
async updateCurrentTabId(tabId: number | null): Promise<void>
async getTabInfo(tabId: number): Promise<{ title: string; url: string }>
async summarizeTabs(): Promise<string>
async waitUntilTabLoaded(tabId: number): Promise<void>
dispose(): void
```

#### Internal `TabMeta` type

```typescript
interface TabMeta {
  id: number
  isInitial: boolean
  url?: string
  title?: string
  status?: 'loading' | 'unloaded' | 'complete'
}
```

---

### 4.3 `RemotePageController`

**File:** `packages/extension/src/agent/RemotePageController.ts`

Proxy that forwards all `PageController` method calls from the side panel to the content script of the active tab via `chrome.runtime.sendMessage`.

#### Constructor

```typescript
constructor(tabsController: TabsController)
```

#### Communication Protocol

All messages use the `PAGE_CONTROL` type:

```typescript
// Outgoing (sidepanel → background → content script)
{
  type: 'PAGE_CONTROL',
  action: 'get_browser_state' | 'click_element' | 'input_text' |
          'select_option' | 'scroll' | 'scroll_horizontally' |
          'execute_javascript' | 'update_tree' | 'clean_up_highlights' |
          'show_mask' | 'hide_mask' | 'get_last_update_time',
  targetTabId: number,
  payload?: any
}

// Incoming (response)
{ result: any } | { error: string }
```

#### Full Method List

Same interface as `PageController` — all methods are async proxies:

```typescript
async getBrowserState(): Promise<BrowserState>
async updateTree(): Promise<void>
async cleanUpHighlights(): Promise<void>
async clickElement(...args): Promise<DomActionReturn>
async inputText(...args): Promise<DomActionReturn>
async selectOption(...args): Promise<DomActionReturn>
async scroll(...args): Promise<DomActionReturn>
async scrollHorizontally(...args): Promise<DomActionReturn>
async executeJavascript(...args): Promise<DomActionReturn>
async showMask(): Promise<void>
async hideMask(): Promise<void>
dispose(): void
```

---

### 4.4 Extension Message Flow

```
MultiPageAgent (side panel)
  │
  │  tool.execute() → RemotePageController method
  ▼
chrome.runtime.sendMessage({ type: 'PAGE_CONTROL', action, targetTabId, payload })
  │
  ▼
background.ts  (service worker)
  │  routes by targetTabId
  ▼
chrome.tabs.sendMessage(tabId, message)
  │
  ▼
content.ts  (content script, per tab)
  │  dispatches to PageController instance
  ▼
PageController  (runs in page context)
  │
  ▼
DOM (click / type / scroll / snapshot)
```

---

## 5. Key Type Definitions

### 5.1 Agent Types (`packages/core/src/types.ts`)

```typescript
type AgentStatus = 'idle' | 'running' | 'completed' | 'error'

interface AgentConfig extends LLMConfig {
  language?: 'en-US' | 'zh-CN'
  maxSteps?: number                          // default: 40
  customTools?: Record<string, PageAgentTool | null>
  instructions?: {
    system?: string
    getPageInstructions?: (url: string) => string | undefined | null
  }
  onBeforeStep?: (agent, step) => void | Promise<void>
  onAfterStep?: (agent, history) => void | Promise<void>
  onBeforeTask?: (agent) => void | Promise<void>
  onAfterTask?: (agent, result) => void | Promise<void>
  onDispose?: (agent, reason?) => void
  experimentalScriptExecutionTool?: boolean
  customSystemPrompt?: string
}

interface ExecutionResult {
  success: boolean
  data: string                               // final answer or error message
  history: HistoricalEvent[]
}

// Step recorded to history
interface AgentStepEvent {
  type: 'step'
  stepIndex: number
  reflection: {
    evaluation_previous_goal?: string
    memory?: string
    next_goal?: string
  }
  action: { name: string; input: any; output: string }
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedTokens?: number
    reasoningTokens?: number
  }
}

type HistoricalEvent =
  | AgentStepEvent
  | { type: 'observation'; content: string }
  | { type: 'user_takeover' }
  | { type: 'retry'; message: string; attempt: number; maxAttempts: number }
  | { type: 'error'; message: string }

type AgentActivity =
  | { type: 'thinking' }
  | { type: 'executing'; tool: string; input: unknown }
  | { type: 'executed'; tool: string; input: unknown; output: string; duration: number }
  | { type: 'retrying'; attempt: number; maxAttempts: number }
  | { type: 'error'; message: string }
```

---

### 5.2 LLM Types (`packages/llms/src/types.ts`)

```typescript
interface LLMConfig {
  baseURL?: string          // Omit for Azure OpenAI
  apiKey?: string           // Omit for Azure OpenAI
  model?: string            // Omit for Azure OpenAI
  temperature?: number
  maxRetries?: number
  customFetch?: typeof globalThis.fetch
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

interface InvokeResult<TResult = unknown> {
  toolCall: { name: string; args: any }
  toolResult: TResult
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedTokens?: number
    reasoningTokens?: number
  }
  rawResponse?: unknown
  rawRequest?: unknown
}
```

---

### 5.3 DOM Types (`packages/page-controller/src`)

```typescript
// Returned by getBrowserState()
interface BrowserState {
  url: string
  title: string
  header: string      // Page info + scroll position
  content: string     // Simplified interactive HTML (LLM-ready)
  footer: string      // Hint for the LLM
}

// Flat tree structure
interface FlatDomTree {
  rootId: string
  map: Record<string, TextDomNode | ElementDomNode | InteractiveElementDomNode>
}

// Interactive element (has highlight index + DOM ref)
interface InteractiveElementDomNode {
  tagName: string
  attributes?: Record<string, string>
  isInteractive: true
  highlightIndex: number
  ref: HTMLElement       // Live DOM reference
}
```

---

## 6. Built-in Tools

All tools share the `PageAgentTool` interface and are executed with `this = PageAgentCore`:

```typescript
interface PageAgentTool<TParams = any> {
  description?: string
  inputSchema: z.ZodType<TParams>
  execute: (this: PageAgentCore, args: TParams) => Promise<string>
}
```

### Tool Reference

| Tool | Input | Description |
|---|---|---|
| `done` | `{ text: string, success?: boolean }` | Complete task, return final answer |
| `wait` | `{ seconds: number }` | Wait 1-10 seconds for page load |
| `ask_user` | `{ question: string }` | Prompt user for input |
| `click_element_by_index` | `{ index: number }` | Click interactive element by highlight index |
| `input_text` | `{ index: number, text: string }` | Type text into input/textarea |
| `select_dropdown_option` | `{ index: number, text: string }` | Choose a `<select>` option by text |
| `scroll` | `{ down, num_pages, pixels?, index? }` | Scroll page or element vertically |
| `scroll_horizontally` | `{ right, pixels, index? }` | Scroll page or element horizontally |
| `execute_javascript` | `{ script: string }` | Run arbitrary JS (experimental flag required) |

### Extension-only Tab Tools (`tabTools.ts`)

| Tool | Description |
|---|---|
| `open_new_tab` | Open URL in a new tab, switch to it |
| `switch_to_tab` | Bring a tab into focus |
| `close_tab` | Close a specific tab |

---

## 7. Azure OpenAI Configuration

**File:** `packages/llms/src/azure-openai-models.ts`

| Constant | Value | Purpose |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | `https://datacopilothub8882317788.cognitiveservices.azure.com/` | API endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | *(deployment name)* | GPT model deployment |
| `AZURE_OPENAI_API_VERSION` | *(api version string)* | Azure OpenAI API version |
| `AZURE_OPENAI_SCOPE` | `https://cognitiveservices.azure.com/.default` | OAuth2 scope |
| `AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID` | *(managed identity GUID)* | Server-side only |
| `AZURE_OPENAI_BROWSER_CLIENT_ID` | `5e10fe82-09d3-4404-88e5-2f8e98ff7b67` | Browser OAuth2 app registration |

### Authentication by Environment

| Environment | Credential Class | Mechanism |
|---|---|---|
| Local development | `AzureCliCredential` | `az login` — token from Azure CLI |
| Extension (production build) | `ManagedIdentityCredential` (shim) | OAuth2 PKCE via `chrome.identity` |

---

## 8. Extension Build

**File:** `packages/extension/wxt.config.js`

The Vite alias replaces the server-side `@azure/identity` package with the browser shim at bundle time:

```javascript
resolve: {
  alias: {
    '@azure/identity': path.resolve(__dirname, 'src/azure-identity-browser.ts')
  }
}
```

### Build Commands

```bash
# Development mode (hot reload)
npm run dev:edge --workspace=@page-agent/ext

# Production build
npm run build:edge --workspace=@page-agent/ext

# Zip for distribution
npm run zip:edge --workspace=@page-agent/ext
```

Output: `packages/extension/.output/edge-mv3/`

---

## 9. End-to-End Request Trace

A single agent step — from user prompt to DOM action — follows this path:

```
1. User types task → SidePanel.tsx calls agent.execute(task)

2. PageAgentCore.execute()
   └─ loop: getBrowserState() → assemblePrompt() → LLM.invoke()

3. LLM.invoke() → AzureOpenAIClient.invoke()
   └─ getToken()
        └─ ManagedIdentityCredential.getToken(scope)
             └─ acquireToken() [azure-identity-browser.ts]
                  └─ chrome.identity.launchWebAuthFlow() → Azure AD PKCE
                       → access_token (cached for ~55 min)

4. fetch(AZURE_OPENAI_ENDPOINT + deployment + "?api-version=…")
   Headers: Authorization: Bearer <token>
   Body: { model, messages, tools, tool_choice: "required" }

5. Azure OpenAI responds: { tool_calls: [{ function: { name, arguments } }] }

6. PageAgentCore dispatches tool call:
   e.g. click_element_by_index({ index: 3 })
     → RemotePageController.clickElement(3)
          → chrome.runtime.sendMessage({ type: 'PAGE_CONTROL', action: 'click_element', ... })
               → background.ts → chrome.tabs.sendMessage(tabId, msg)
                    → content.ts → PageController.clickElement(3)
                         → selectorMap.get(3).ref.click()

7. DOM updates → next loop iteration re-snapshots page
```
