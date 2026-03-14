import { AzureOpenAIClient, OpenAIClient } from './OpenAIClient'
import { DEFAULT_TEMPERATURE, LLM_MAX_RETRIES } from './constants'
import { InvokeError, InvokeErrorType } from './errors'
import type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool } from './types'

export { AzureOpenAIClient, OpenAIClient }
export type { AzureOpenAIConfig } from './OpenAIClient'
export { InvokeError, InvokeErrorType }
export type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool }

/**
 * Returns true when the config has enough fields to use an OpenAI-compatible client.
 * When baseURL is absent the LLM class falls back to AzureOpenAIClient.
 */
function isOpenAIConfig(
	config: LLMConfig
): config is LLMConfig & { baseURL: string; apiKey: string; model: string } {
	return Boolean(config.baseURL && config.apiKey && config.model)
}

export function parseLLMConfig(config: LLMConfig): Required<LLMConfig> {
	if (isOpenAIConfig(config)) {
		return {
			baseURL: config.baseURL,
			apiKey: config.apiKey,
			model: config.model,
			temperature: config.temperature ?? DEFAULT_TEMPERATURE,
			maxRetries: config.maxRetries ?? LLM_MAX_RETRIES,
			customFetch: (config.customFetch ?? fetch).bind(globalThis),
		}
	}

	// Azure mode — baseURL / apiKey / model come from azure-openai-models.ts
	return {
		baseURL: '',
		apiKey: '',
		model: '',
		temperature: config.temperature ?? DEFAULT_TEMPERATURE,
		maxRetries: config.maxRetries ?? LLM_MAX_RETRIES,
		customFetch: (config.customFetch ?? fetch).bind(globalThis),
	}
}

export class LLM extends EventTarget {
	config: Required<LLMConfig>
	client: LLMClient

	constructor(config: LLMConfig = {}) {
		super()
		this.config = parseLLMConfig(config)

		if (isOpenAIConfig(config)) {
			this.client = new OpenAIClient(this.config)
		} else {
			// Default: Azure OpenAI with Managed Identity
			this.client = new AzureOpenAIClient({
				temperature: this.config.temperature,
				maxRetries: this.config.maxRetries,
			})
		}
	}

	/**
	 * - call llm api *once*
	 * - invoke tool call *once*
	 * - return the result of the tool
	 */
	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult> {
		return await withRetry(
			async () => {
				// in case user aborted before invoking
				if (abortSignal.aborted) throw new Error('AbortError')

				const result = await this.client.invoke(messages, tools, abortSignal, options)

				return result
			},
			// retry settings
			{
				maxRetries: this.config.maxRetries,
				onRetry: (attempt: number) => {
					this.dispatchEvent(
						new CustomEvent('retry', { detail: { attempt, maxAttempts: this.config.maxRetries } })
					)
				},
				onError: (error: Error) => {
					this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
				},
			}
		)
	}
}

async function withRetry<T>(
	fn: () => Promise<T>,
	settings: {
		maxRetries: number
		onRetry: (attempt: number) => void
		onError: (error: Error) => void
	}
): Promise<T> {
	let attempt = 0
	let lastError: Error | null = null
	while (attempt <= settings.maxRetries) {
		if (attempt > 0) {
			settings.onRetry(attempt)
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		try {
			return await fn()
		} catch (error: unknown) {
			// do not retry if aborted by user
			if ((error as any)?.rawError?.name === 'AbortError') throw error

			console.error(error)
			settings.onError(error as Error)

			// do not retry if error is not retryable (InvokeError)
			if (error instanceof InvokeError && !error.retryable) throw error

			lastError = error as Error
			attempt++

			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	throw lastError!
}
