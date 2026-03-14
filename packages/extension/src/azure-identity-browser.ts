/**
 * Browser-compatible stub for @azure/identity
 *
 * Uses OAuth2 Authorization Code + PKCE flow — no implicit grant needed.
 * Works with default Azure AD app registration settings.
 *
 * Azure AD app requirements:
 *  - Platform: "Single-page application" (SPA) — NOT Web, NOT Mobile
 *  - Redirect URI: https://<extension-id>.chromiumapp.org/
 *    Get the exact value by running chrome.identity.getRedirectURL() in extension DevTools.
 */

const TOKEN_SAFETY_BUFFER_MS = 5 * 60 * 1000

// Use 'common' for multi-tenant; replace with your AAD tenant ID or domain if needed.
// e.g. 'contoso.onmicrosoft.com' or a tenant GUID
const AAD_TENANT = 'common'

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64urlEncode(buffer: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(buffer)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '')
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const bytes = new Uint8Array(32)
	crypto.getRandomValues(bytes)
	const verifier = base64urlEncode(bytes.buffer)
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
	const challenge = base64urlEncode(hash)
	return { verifier, challenge }
}

// ─── Token acquisition ────────────────────────────────────────────────────────

async function acquireToken(
	clientId: string,
	scope: string
): Promise<{ token: string; expiresOnTimestamp: number }> {
	const redirectUrl = chrome.identity.getRedirectURL()
	const { verifier, challenge } = await generatePKCE()

	// Step 1 — authorization code via interactive browser popup
	const authUrl = new URL(`https://login.microsoftonline.com/${AAD_TENANT}/oauth2/v2.0/authorize`)
	authUrl.searchParams.set('client_id', clientId)
	authUrl.searchParams.set('response_type', 'code')
	authUrl.searchParams.set('redirect_uri', redirectUrl)
	authUrl.searchParams.set('scope', `${scope} offline_access`)
	authUrl.searchParams.set('code_challenge', challenge)
	authUrl.searchParams.set('code_challenge_method', 'S256')
	authUrl.searchParams.set('response_mode', 'query')

	const responseUrl = await new Promise<string>((resolve, reject) => {
		chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, (url) => {
			if (chrome.runtime.lastError || !url) {
				reject(
					new Error(
						chrome.runtime.lastError?.message ??
							`Azure AD login failed.\n` +
								`Ensure the app (client_id=${clientId}) has:\n` +
								`  - Platform type "Single-page application" (SPA)\n` +
								`  - Redirect URI "${redirectUrl}" added`
					)
				)
			} else {
				resolve(url)
			}
		})
	})

	const code = new URL(responseUrl).searchParams.get('code')
	if (!code) throw new Error('No authorization code in Azure AD redirect response')

	// Step 2 — exchange code for access token (no client secret needed with PKCE)
	const tokenRes = await fetch(
		`https://login.microsoftonline.com/${AAD_TENANT}/oauth2/v2.0/token`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: clientId,
				code,
				redirect_uri: redirectUrl,
				code_verifier: verifier,
				scope: `${scope} offline_access`,
			}).toString(),
		}
	)

	if (!tokenRes.ok) {
		const err = await tokenRes.json().catch(() => ({}))
		throw new Error(
			`Azure AD token exchange failed (${tokenRes.status}): ${(err as any).error_description ?? tokenRes.statusText}`
		)
	}

	const data = await tokenRes.json()
	const accessToken: string = data.access_token
	const expiresIn: number = data.expires_in ?? 3600

	if (!accessToken) throw new Error('No access_token in Azure AD token response')

	return {
		token: accessToken,
		expiresOnTimestamp: Date.now() + expiresIn * 1000 - TOKEN_SAFETY_BUFFER_MS,
	}
}

// ─── Credential classes (same interface as @azure/identity) ──────────────────

/** Browser replacement for AzureCliCredential */
export class AzureCliCredential {
	getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number }> {
		return acquireToken('', scope)
	}
}

/** Browser replacement for ManagedIdentityCredential */
export class ManagedIdentityCredential {
	private clientId: string

	constructor(clientId?: string) {
		this.clientId = clientId ?? ''
	}

	getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number }> {
		return acquireToken(this.clientId, scope)
	}
}
