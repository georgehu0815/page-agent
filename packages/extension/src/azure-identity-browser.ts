/**
 * Browser-compatible stub for @azure/identity
 *
 * Replaces the Node.js-only credential classes with browser OAuth2 via
 * chrome.identity.launchWebAuthFlow. Aliased in wxt.config.js so Vite
 * never bundles the real @azure/identity into the extension.
 *
 * Azure AD app requirements:
 *  - Implicit grant / token flow enabled
 *  - Redirect URI: https://<extension-id>.chromiumapp.org/
 *    (chrome.identity.getRedirectURL() returns the exact value)
 */

const TOKEN_SAFETY_BUFFER_MS = 5 * 60 * 1000

// Use 'common' for multi-tenant; replace with your AAD tenant ID if needed.
const AAD_TENANT = 'common'

async function acquireToken(
	clientId: string,
	scope: string
): Promise<{ token: string; expiresOnTimestamp: number }> {
	const redirectUrl = chrome.identity.getRedirectURL()

	const authUrl = new URL(`https://login.microsoftonline.com/${AAD_TENANT}/oauth2/v2.0/authorize`)
	authUrl.searchParams.set('client_id', clientId)
	authUrl.searchParams.set('response_type', 'token')
	authUrl.searchParams.set('redirect_uri', redirectUrl)
	authUrl.searchParams.set('scope', scope)
	authUrl.searchParams.set('response_mode', 'fragment')

	const responseUrl = await new Promise<string>((resolve, reject) => {
		chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, (url) => {
			if (chrome.runtime.lastError || !url) {
				reject(
					new Error(
						chrome.runtime.lastError?.message ??
							`Azure OAuth2 flow failed. ` +
								`Ensure the app registration for client_id=${clientId} has ` +
								`implicit grant enabled and redirect URI ${redirectUrl} whitelisted.`
					)
				)
			} else {
				resolve(url)
			}
		})
	})

	const fragment = new URL(responseUrl).hash.slice(1)
	const params = new URLSearchParams(fragment)
	const token = params.get('access_token')
	const expiresIn = parseInt(params.get('expires_in') ?? '3600', 10)

	if (!token) {
		throw new Error(
			'No access_token in Azure OAuth2 response. ' +
				'Check the app registration and ensure implicit grant is enabled.'
		)
	}

	return {
		token,
		expiresOnTimestamp: Date.now() + expiresIn * 1000 - TOKEN_SAFETY_BUFFER_MS,
	}
}

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
