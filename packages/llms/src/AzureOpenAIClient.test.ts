/**
 * Tests for AzureOpenAIClient
 *
 * Covers:
 * - Credential selection (AzureCliCredential in dev, ManagedIdentityCredential in prod)
 * - Token caching and refresh before expiry
 * - fetchCompletion URL and headers
 * - Full invoke() with a mocked Azure response
 */
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'

import { AzureOpenAIClient } from './OpenAIClient'
import {
	AZURE_OPENAI_API_VERSION,
	AZURE_OPENAI_DEPLOYMENT,
	AZURE_OPENAI_ENDPOINT,
} from './azure-openai-models'

// ─── Hoist mock state so it's available inside vi.mock factory ────────────────

const mockGetToken = vi.hoisted(() => vi.fn())

vi.mock('@azure/identity', () => ({
	// Must use regular `function` (not arrow) so `new Foo()` works
	AzureCliCredential: vi.fn(function (this: { getToken: typeof mockGetToken }) {
		this.getToken = mockGetToken
	}),
	ManagedIdentityCredential: vi.fn(function (
		this: { getToken: typeof mockGetToken },
		_clientId?: string
	) {
		this.getToken = mockGetToken
	}),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FUTURE = Date.now() + 60 * 60 * 1000 // 1 hour from now
const MOCK_TOKEN = 'mock-managed-identity-token'

function mockTokenResponse(token = MOCK_TOKEN, expiresAt = FUTURE) {
	mockGetToken.mockResolvedValue({ token, expiresOnTimestamp: expiresAt })
}

/** Minimal valid Azure OpenAI chat/completions response with a tool call */
function makeAzureResponse(toolName: string, args: Record<string, unknown>) {
	return {
		id: 'chatcmpl-test',
		object: 'chat.completion',
		choices: [
			{
				index: 0,
				finish_reason: 'tool_calls',
				message: {
					role: 'assistant',
					tool_calls: [
						{
							id: 'call_test',
							type: 'function',
							function: { name: toolName, arguments: JSON.stringify(args) },
						},
					],
				},
			},
		],
		usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
	}
}

function mockFetchOk(toolName: string, args: Record<string, unknown>) {
	// Return a fresh Response each call — body can only be read once
	return vi.fn().mockImplementation(() =>
		Promise.resolve(
			new Response(JSON.stringify(makeAzureResponse(toolName, args)), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		)
	)
}

/** A minimal echo tool for invoke() tests */
function echoTool(schema: z.ZodType) {
	return {
		description: 'echo',
		inputSchema: schema,
		execute: async (args: unknown) => args,
	}
}

const doneSchema = z.object({ text: z.string(), success: z.boolean() })
const doneArgs = { text: 'Task done', success: true }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AzureOpenAIClient — credential selection', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('uses AzureCliCredential when NODE_ENV is not production', () => {
		process.env.NODE_ENV = 'development'
		new AzureOpenAIClient()
		expect(AzureCliCredential).toHaveBeenCalledTimes(1)
		expect(ManagedIdentityCredential).not.toHaveBeenCalled()
	})

	it('uses ManagedIdentityCredential when NODE_ENV is production', () => {
		process.env.NODE_ENV = 'production'
		new AzureOpenAIClient()
		expect(ManagedIdentityCredential).toHaveBeenCalledTimes(1)
		expect(AzureCliCredential).not.toHaveBeenCalled()
	})

	it('passes the managed identity client id to ManagedIdentityCredential', async () => {
		process.env.NODE_ENV = 'production'
		const { AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID } = await import('./azure-openai-models')
		new AzureOpenAIClient()
		expect(ManagedIdentityCredential).toHaveBeenCalledWith(AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID)
	})
})

describe('AzureOpenAIClient — token caching', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		process.env.NODE_ENV = 'development'
	})

	it('fetches a token on the first call to fetchCompletion', async () => {
		mockTokenResponse()
		globalThis.fetch = mockFetchOk('done', doneArgs)

		const client = new AzureOpenAIClient()
		await client.invoke(
			[{ role: 'user', content: 'test' }],
			{ done: echoTool(doneSchema) },
			new AbortController().signal
		)

		expect(mockGetToken).toHaveBeenCalledTimes(1)
	})

	it('reuses cached token on subsequent calls without re-fetching', async () => {
		mockTokenResponse()
		globalThis.fetch = mockFetchOk('done', doneArgs)

		const client = new AzureOpenAIClient()
		const tools = { done: echoTool(doneSchema) }
		const signal = new AbortController().signal

		await client.invoke([{ role: 'user', content: 'first' }], tools, signal)
		await client.invoke([{ role: 'user', content: 'second' }], tools, signal)

		expect(mockGetToken).toHaveBeenCalledTimes(1)
	})

	it('refreshes token when close to expiry (within 5-min safety buffer)', async () => {
		// Token expires in 4 min — inside the 5-min buffer, so treated as expired
		const nearExpiry = Date.now() + 4 * 60 * 1000
		mockGetToken
			.mockResolvedValueOnce({ token: 'token-1', expiresOnTimestamp: nearExpiry })
			.mockResolvedValue({ token: 'token-2', expiresOnTimestamp: FUTURE })

		const capturedTokens: string[] = []
		globalThis.fetch = vi.fn().mockImplementation((_: string, init: RequestInit) => {
			capturedTokens.push((init.headers as Record<string, string>).Authorization)
			// Create a fresh Response each call — body can only be read once
			return Promise.resolve(
				new Response(JSON.stringify(makeAzureResponse('done', doneArgs)), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			)
		})

		const client = new AzureOpenAIClient()
		const tools = { done: echoTool(doneSchema) }
		const signal = new AbortController().signal

		await client.invoke([{ role: 'user', content: 'first' }], tools, signal)
		await client.invoke([{ role: 'user', content: 'second' }], tools, signal)

		expect(mockGetToken).toHaveBeenCalledTimes(2)
		expect(capturedTokens[0]).toBe('Bearer token-1')
		expect(capturedTokens[1]).toBe('Bearer token-2')
	})
})

describe('AzureOpenAIClient — fetchCompletion request format', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		process.env.NODE_ENV = 'development'
		mockTokenResponse()
	})

	it('sends request to the correct Azure deployment URL with api-version', async () => {
		let capturedUrl = ''
		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			capturedUrl = url
			return Promise.resolve(
				new Response(JSON.stringify(makeAzureResponse('done', doneArgs)), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			)
		})

		const client = new AzureOpenAIClient()
		await client.invoke(
			[{ role: 'user', content: 'test' }],
			{ done: echoTool(doneSchema) },
			new AbortController().signal
		)

		const expectedUrl =
			`${AZURE_OPENAI_ENDPOINT}openai/deployments/${AZURE_OPENAI_DEPLOYMENT}` +
			`/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`
		expect(capturedUrl).toBe(expectedUrl)
	})

	it('sends Authorization: Bearer <token> and api-key headers', async () => {
		let capturedHeaders: Record<string, string> = {}
		globalThis.fetch = vi.fn().mockImplementation((_: string, init: RequestInit) => {
			capturedHeaders = init.headers as Record<string, string>
			return Promise.resolve(
				new Response(JSON.stringify(makeAzureResponse('done', doneArgs)), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			)
		})

		const client = new AzureOpenAIClient()
		await client.invoke(
			[{ role: 'user', content: 'test' }],
			{ done: echoTool(doneSchema) },
			new AbortController().signal
		)

		expect(capturedHeaders.Authorization).toBe(`Bearer ${MOCK_TOKEN}`)
		expect(capturedHeaders['api-key']).toBe(MOCK_TOKEN)
		expect(capturedHeaders['Content-Type']).toBe('application/json')
	})

	it('sends the Azure deployment name as the model in the request body', async () => {
		let capturedBody: Record<string, unknown> = {}
		globalThis.fetch = vi.fn().mockImplementation((_: string, init: RequestInit) => {
			capturedBody = JSON.parse(init.body as string)
			return Promise.resolve(
				new Response(JSON.stringify(makeAzureResponse('done', doneArgs)), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			)
		})

		const client = new AzureOpenAIClient()
		await client.invoke(
			[{ role: 'user', content: 'test' }],
			{ done: echoTool(doneSchema) },
			new AbortController().signal
		)

		expect(capturedBody.model).toBe(AZURE_OPENAI_DEPLOYMENT)
	})
})

describe('AzureOpenAIClient — invoke() response parsing', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		process.env.NODE_ENV = 'development'
		mockTokenResponse()
	})

	it('parses a valid tool call response and executes the tool', async () => {
		globalThis.fetch = mockFetchOk('done', doneArgs)

		const client = new AzureOpenAIClient()
		const result = await client.invoke(
			[{ role: 'user', content: 'do something' }],
			{ done: echoTool(doneSchema) },
			new AbortController().signal
		)

		expect(result.toolCall.name).toBe('done')
		expect(result.toolCall.args).toEqual(doneArgs)
		expect(result.toolResult).toEqual(doneArgs)
		expect(result.usage.promptTokens).toBe(10)
		expect(result.usage.completionTokens).toBe(5)
		expect(result.usage.totalTokens).toBe(15)
	})

	it('throws AUTH_ERROR on 401 response', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			})
		)

		const client = new AzureOpenAIClient()
		await expect(
			client.invoke(
				[{ role: 'user', content: 'test' }],
				{ done: echoTool(doneSchema) },
				new AbortController().signal
			)
		).rejects.toThrow('Authentication failed')
	})

	it('throws RATE_LIMIT error on 429 response', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: { message: 'Too Many Requests' } }), {
				status: 429,
				headers: { 'Content-Type': 'application/json' },
			})
		)

		const client = new AzureOpenAIClient()
		await expect(
			client.invoke(
				[{ role: 'user', content: 'test' }],
				{ done: echoTool(doneSchema) },
				new AbortController().signal
			)
		).rejects.toThrow('Rate limit exceeded')
	})

	it('throws a network error wrapping the credential failure when getToken() rejects', async () => {
		mockGetToken.mockRejectedValue(new Error('No credentials available'))

		const client = new AzureOpenAIClient()
		// getToken() throws inside fetchCompletion(), which is caught by invoke()'s
		// network-error handler and re-thrown as InvokeError("Network request failed")
		await expect(
			client.invoke(
				[{ role: 'user', content: 'test' }],
				{ done: echoTool(doneSchema) },
				new AbortController().signal
			)
		).rejects.toThrow('Network request failed')
	})
})
