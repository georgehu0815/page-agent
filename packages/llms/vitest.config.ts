import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		globals: false,
		include: ['src/**/*.test.ts'],
		alias: {
			// Ensure zod/v4 resolves correctly in tests
			'zod/v4': new URL('../../node_modules/zod/v4', import.meta.url).pathname,
		},
	},
})
