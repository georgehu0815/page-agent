import type { LLMConfig } from '@page-agent/llms'
import {
	AZURE_OPENAI_API_VERSION,
	AZURE_OPENAI_DEPLOYMENT,
	AZURE_OPENAI_ENDPOINT,
	AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID,
	AZURE_OPENAI_SCOPE,
} from '@page-agent/llms'

// Re-export so extension code can import from one place
export {
	AZURE_OPENAI_API_VERSION,
	AZURE_OPENAI_DEPLOYMENT,
	AZURE_OPENAI_ENDPOINT,
	AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID,
	AZURE_OPENAI_SCOPE,
}

// Default config — no baseURL/apiKey/model means AzureOpenAIClient is used automatically
export const AZURE_CONFIG: LLMConfig = {}

/** Legacy testing endpoints that should be auto-migrated to Azure */
export const LEGACY_TESTING_ENDPOINTS = [
	// 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run',
	'https://hwcxiuzfylggtcktqgij.supabase.co/functions/v1/llm-testing-proxy',
]

export function isTestingEndpoint(url: string): boolean {
	const normalized = url.replace(/\/+$/, '')
	return LEGACY_TESTING_ENDPOINTS.some((ep) => normalized === ep)
}

export function migrateLegacyEndpoint(config: LLMConfig): LLMConfig {
	const normalized = (config.baseURL ?? '').replace(/\/+$/, '')
	if (LEGACY_TESTING_ENDPOINTS.some((ep) => normalized === ep)) {
		return { ...AZURE_CONFIG }
	}
	return config
}
