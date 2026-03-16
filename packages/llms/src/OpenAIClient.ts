/**
 * OpenAI Client implementation
 */
// ─── Azure OpenAI ─────────────────────────────────────────────────────────────
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import * as z from 'zod/v4'

import {
	AZURE_OPENAI_API_VERSION,
	AZURE_OPENAI_DEPLOYMENT,
	AZURE_OPENAI_ENDPOINT,
	AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID,
	AZURE_OPENAI_SCOPE,
} from './azure-openai-models'
import { DEFAULT_TEMPERATURE, LLM_MAX_RETRIES } from './constants'
import { InvokeError, InvokeErrorType } from './errors'
import type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool } from './types'
import { modelPatch, zodToOpenAITool } from './utils'

/**
 * Client for OpenAI compatible APIs
 */
export class OpenAIClient implements LLMClient {
	config: Required<LLMConfig>
	protected fetch: typeof globalThis.fetch

	constructor(config: Required<LLMConfig>) {
		this.config = config
		this.fetch = config.customFetch
	}

	/**
	 * Perform the HTTP request to the chat completions endpoint.
	 * Override in subclasses to change the URL, auth headers, or transport (e.g. Azure).
	 */
	protected async fetchCompletion(
		requestBody: Record<string, unknown>,
		abortSignal?: AbortSignal
	): Promise<Response> {
		return await this.fetch(`${this.config.baseURL}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.config.apiKey}`,
			},
			body: JSON.stringify(requestBody),
			signal: abortSignal,
		})
	}

	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal?: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult> {
		// 1. Convert tools to OpenAI format
		const openaiTools = Object.entries(tools).map(([name, t]) => zodToOpenAITool(name, t))

		// Build request body
		const requestBody: Record<string, unknown> = {
			model: this.config.model,
			temperature: this.config.temperature,
			messages,
			tools: openaiTools,
			parallel_tool_calls: false,
			// Require tool call: specific tool if provided, otherwise any tool
			tool_choice: options?.toolChoiceName
				? { type: 'function', function: { name: options.toolChoiceName } }
				: 'required',
		}

		modelPatch(requestBody)

		// 2. Call API
		let response: Response
		try {
			response = await this.fetchCompletion(requestBody, abortSignal)
		} catch (error: unknown) {
			const isAbortError = (error as any)?.name === 'AbortError'
			if (isAbortError) {
				throw new InvokeError(InvokeErrorType.NETWORK_ERROR, 'Network request aborted', error)
			}
			const cause = (error as any)?.message ?? String(error)
			console.error('[LLM] fetchCompletion failed:', error)
			throw new InvokeError(
				InvokeErrorType.NETWORK_ERROR,
				`Network request failed: ${cause}`,
				error
			)
		}

		// 3. Handle HTTP errors
		if (!response.ok) {
			const errorData = await response.json().catch()
			const errorMessage =
				(errorData as { error?: { message?: string } }).error?.message || response.statusText

			if (response.status === 401 || response.status === 403) {
				throw new InvokeError(
					InvokeErrorType.AUTH_ERROR,
					`Authentication failed: ${errorMessage}`,
					errorData
				)
			}
			if (response.status === 429) {
				throw new InvokeError(
					InvokeErrorType.RATE_LIMIT,
					`Rate limit exceeded: ${errorMessage}`,
					errorData
				)
			}
			if (response.status >= 500) {
				throw new InvokeError(
					InvokeErrorType.SERVER_ERROR,
					`Server error: ${errorMessage}`,
					errorData
				)
			}
			throw new InvokeError(
				InvokeErrorType.UNKNOWN,
				`HTTP ${response.status}: ${errorMessage}`,
				errorData
			)
		}

		// 4. Parse and validate response
		const data = await response.json()

		const choice = data.choices?.[0]
		if (!choice) {
			throw new InvokeError(InvokeErrorType.UNKNOWN, 'No choices in response', data)
		}

		// Check finish_reason
		switch (choice.finish_reason) {
			case 'tool_calls':
			case 'function_call': // gemini
			case 'stop': // some models use this even with tool calls
				break
			case 'length':
				throw new InvokeError(
					InvokeErrorType.CONTEXT_LENGTH,
					'Response truncated: max tokens reached',
					undefined,
					data
				)
			case 'content_filter':
				throw new InvokeError(
					InvokeErrorType.CONTENT_FILTER,
					'Content filtered by safety system',
					undefined,
					data
				)
			default:
				throw new InvokeError(
					InvokeErrorType.UNKNOWN,
					`Unexpected finish_reason: ${choice.finish_reason}`,
					undefined,
					data
				)
		}

		// Apply normalizeResponse if provided (for fixing format issues automatically)
		const normalizedData = options?.normalizeResponse ? options.normalizeResponse(data) : data
		const normalizedChoice = (normalizedData as any).choices?.[0]

		// Get tool name from response
		const toolCallName = normalizedChoice?.message?.tool_calls?.[0]?.function?.name
		if (!toolCallName) {
			throw new InvokeError(
				InvokeErrorType.NO_TOOL_CALL,
				'No tool call found in response',
				undefined,
				data
			)
		}

		const tool = tools[toolCallName]
		if (!tool) {
			throw new InvokeError(
				InvokeErrorType.UNKNOWN,
				`Tool "${toolCallName}" not found in tools`,
				undefined,
				data
			)
		}

		// Extract and parse tool arguments
		const argString = normalizedChoice.message?.tool_calls?.[0]?.function?.arguments
		if (!argString) {
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				'No tool call arguments found',
				undefined,
				data
			)
		}

		let parsedArgs: unknown
		try {
			parsedArgs = JSON.parse(argString)
		} catch (error) {
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				'Failed to parse tool arguments as JSON',
				error,
				data
			)
		}

		// Validate with schema
		const validation = tool.inputSchema.safeParse(parsedArgs)
		if (!validation.success) {
			console.error(z.prettifyError(validation.error))
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				'Tool arguments validation failed',
				validation.error,
				data
			)
		}
		const toolInput = validation.data

		// 5. Execute tool
		let toolResult: unknown
		try {
			toolResult = await tool.execute(toolInput)
		} catch (e) {
			throw new InvokeError(
				InvokeErrorType.TOOL_EXECUTION_ERROR,
				`Tool execution failed: ${(e as Error).message}`,
				e,
				data
			)
		}

		// Return result
		return {
			toolCall: {
				name: toolCallName,
				args: toolInput,
			},
			toolResult,
			usage: {
				promptTokens: data.usage?.prompt_tokens ?? 0,
				completionTokens: data.usage?.completion_tokens ?? 0,
				totalTokens: data.usage?.total_tokens ?? 0,
				cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens,
				reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
			},
			rawResponse: data,
			rawRequest: requestBody,
		}
	}
}

export interface AzureOpenAIConfig {
	/** Defaults to DEFAULT_TEMPERATURE (0.7) */
	temperature?: number
	/** Defaults to LLM_MAX_RETRIES (2) */
	maxRetries?: number
}

/**
 * Azure OpenAI client that authenticates via Managed Identity (production)
 * or Azure CLI (development) — no API key required.
 *
 * Uses the deployment and endpoint from azure-openai-models.ts.
 * Extends OpenAIClient and overrides only the HTTP transport so all
 * response parsing, retry logic, and tool execution remain identical.
 */
export class AzureOpenAIClient extends OpenAIClient {
	private credential: AzureCliCredential | ManagedIdentityCredential
	private cachedToken: string | null = null
	private tokenExpiry = 0

	constructor(config?: AzureOpenAIConfig) {
		super({
			// baseURL and apiKey are not used — URL and auth overridden in fetchCompletion
			baseURL: '',
			apiKey: '',
			model: AZURE_OPENAI_DEPLOYMENT,
			temperature: config?.temperature ?? DEFAULT_TEMPERATURE,
			maxRetries: config?.maxRetries ?? LLM_MAX_RETRIES,
			customFetch: fetch.bind(globalThis),
		})

		if (process.env.NODE_ENV === 'production') {
			this.credential = new ManagedIdentityCredential(AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID)
			console.log('[AzureOpenAIClient] Using ManagedIdentityCredential')
		} else {
			this.credential = new AzureCliCredential()
			console.log('[AzureOpenAIClient] Using AzureCliCredential')
		}
	}

	private async getToken(): Promise<string> {
		if (!this.cachedToken || Date.now() >= this.tokenExpiry) {
			const tokenResponse = await this.credential.getToken(AZURE_OPENAI_SCOPE)
			this.cachedToken = tokenResponse.token
			// Refresh 5 minutes before actual expiry to avoid mid-request expiry
			this.tokenExpiry = tokenResponse.expiresOnTimestamp - 5 * 60 * 1000
			console.log('[AzureOpenAIClient] Token refreshed')
		}
		return this.cachedToken
	}

	protected override async fetchCompletion(
		requestBody: Record<string, unknown>,
		abortSignal?: AbortSignal
	): Promise<Response> {
		const token = await this.getToken()
		const url =
			`${AZURE_OPENAI_ENDPOINT}openai/deployments/${AZURE_OPENAI_DEPLOYMENT}` +
			`/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`

		return await this.fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'api-key': token, // Azure OpenAI accepts both headers
			},
			body: JSON.stringify(requestBody),
			signal: abortSignal,
		})
	}
}
