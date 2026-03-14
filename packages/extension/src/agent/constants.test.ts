/**
 * Tests for extension agent constants
 *
 * Covers:
 * - AZURE_CONFIG is empty (triggers AzureOpenAIClient in LLM)
 * - LEGACY_TESTING_ENDPOINTS list
 * - isTestingEndpoint() matching and normalization
 * - migrateLegacyEndpoint() returns AZURE_CONFIG for legacy URLs and passthrough otherwise
 */
import { describe, expect, it } from 'vitest'

import {
	AZURE_CONFIG,
	LEGACY_TESTING_ENDPOINTS,
	isTestingEndpoint,
	migrateLegacyEndpoint,
} from './constants'

describe('AZURE_CONFIG', () => {
	it('is an empty object so AzureOpenAIClient is selected automatically', () => {
		expect(AZURE_CONFIG).toEqual({})
		expect(AZURE_CONFIG.baseURL).toBeUndefined()
		expect(AZURE_CONFIG.apiKey).toBeUndefined()
		expect(AZURE_CONFIG.model).toBeUndefined()
	})
})

describe('isTestingEndpoint', () => {
	it('returns true for a known legacy testing endpoint', () => {
		expect(isTestingEndpoint(LEGACY_TESTING_ENDPOINTS[0])).toBe(true)
	})

	it('returns true when URL has a trailing slash', () => {
		expect(isTestingEndpoint(LEGACY_TESTING_ENDPOINTS[0] + '/')).toBe(true)
	})

	it('returns false for an arbitrary URL', () => {
		expect(isTestingEndpoint('https://api.openai.com/v1')).toBe(false)
	})

	it('returns false for an empty string', () => {
		expect(isTestingEndpoint('')).toBe(false)
	})
})

describe('migrateLegacyEndpoint', () => {
	it('returns AZURE_CONFIG when config uses a legacy testing endpoint', () => {
		const legacyConfig = { baseURL: LEGACY_TESTING_ENDPOINTS[0], apiKey: 'key', model: 'gpt-4' }
		const result = migrateLegacyEndpoint(legacyConfig)
		expect(result).toEqual(AZURE_CONFIG)
	})

	it('migrates legacy endpoint even with trailing slash', () => {
		const legacyConfig = {
			baseURL: LEGACY_TESTING_ENDPOINTS[0] + '/',
			apiKey: 'key',
			model: 'gpt-4',
		}
		const result = migrateLegacyEndpoint(legacyConfig)
		expect(result).toEqual(AZURE_CONFIG)
	})

	it('returns the original config unchanged for a non-legacy URL', () => {
		const config = { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o' }
		const result = migrateLegacyEndpoint(config)
		expect(result).toBe(config)
	})

	it('returns the original config unchanged when baseURL is undefined', () => {
		const config = {}
		const result = migrateLegacyEndpoint(config)
		expect(result).toBe(config)
	})
})
