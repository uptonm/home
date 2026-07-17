import type { CommandSpec } from '../../../core/types'
import { deleteSecret, setSecret } from '../../../core/secrets'
import { resetGoogleTokenCache, runInstalledAppOAuth } from '../../../core/google-auth'
import { DRIVE_SCOPES, MODULE_NAME, readGdriveConfig, REFRESH_TOKEN_KEY } from '../client'

export const authLogin: CommandSpec = {
  path: ['auth', 'login'],
  effect: 'destructive',
  description:
    'Authorize Drive access via the browser (OAuth installed-app flow) and store the refresh token. Interactive — needs a human at a browser; you cannot drive it.',
  args: [
    { name: 'no-browser', kind: 'boolean', description: 'Do not auto-open the browser; just print the URL to open manually' },
    { name: 'login-hint', kind: 'string', description: 'Pre-fill the Google account chooser with this email' },
  ],
  examples: ['home gdrive auth login', 'home gdrive auth login --no-browser'],
  async run(ctx) {
    const { clientId, clientSecret } = readGdriveConfig(ctx.config)
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        kind: 'config',
        message: 'gdrive clientId/clientSecret not set — run `home gdrive configure` first',
        code: 'not_configured',
      }
    }

    const tokens = await runInstalledAppOAuth({
      clientId,
      clientSecret,
      scopes: DRIVE_SCOPES,
      openBrowser: !Boolean(ctx.args['no-browser']),
      loginHint: ctx.args['login-hint'] !== undefined ? String(ctx.args['login-hint']) : undefined,
    })

    setSecret(MODULE_NAME, REFRESH_TOKEN_KEY, tokens.refreshToken)
    resetGoogleTokenCache()
    return { ok: true, data: { status: 'authorized', scope: tokens.scope ?? DRIVE_SCOPES.join(' ') } }
  },
}

export const authLogout: CommandSpec = {
  path: ['auth', 'logout'],
  effect: 'destructive',
  description: 'Forget the stored Drive refresh token (revokes nothing server-side; re-run `auth login` to re-authorize)',
  args: [],
  examples: ['home gdrive auth logout'],
  async run() {
    deleteSecret(MODULE_NAME, REFRESH_TOKEN_KEY)
    resetGoogleTokenCache()
    return { ok: true, data: { status: 'logged_out' } }
  },
}
