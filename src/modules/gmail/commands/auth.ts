import type { CommandSpec } from '../../../core/types'
import { runInstalledAppOAuth } from '../../../core/google-auth'
import { setSecret } from '../../../core/secrets'
import { GMAIL_MODULE, GMAIL_REFRESH_TOKEN_KEY, GMAIL_SCOPES, getProfile } from '../client'

export const authLogin: CommandSpec = {
  path: ['auth', 'login'],
  description:
    'Authorize the CLI against your Google account (opens a browser) and store the refresh token. Run `configure` first to set clientId/clientSecret.',
  args: [
    { name: 'login-hint', kind: 'string', description: 'Pre-fill the account email on the consent screen' },
  ],
  examples: ['home gmail auth login', 'home gmail auth login --login-hint me@gmail.com'],
  async run(ctx) {
    const clientId = String(ctx.config.clientId ?? '')
    const clientSecret = String(ctx.config.clientSecret ?? '')
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        kind: 'config',
        message: 'clientId/clientSecret not set — run `home gmail configure` first',
        code: 'not_configured',
      }
    }

    const tokens = await runInstalledAppOAuth({
      clientId,
      clientSecret,
      scopes: GMAIL_SCOPES,
      loginHint: ctx.args['login-hint'] ? String(ctx.args['login-hint']) : undefined,
    })

    // runInstalledAppOAuth guarantees a refresh token or throws.
    setSecret(GMAIL_MODULE, GMAIL_REFRESH_TOKEN_KEY, tokens.refreshToken!)

    // Confirm the grant works end-to-end before declaring success.
    const profile = await getProfile({ clientId, clientSecret, refreshToken: tokens.refreshToken! })
    return {
      ok: true,
      data: {
        status: 'authenticated',
        emailAddress: profile.emailAddress,
        scope: tokens.scope,
      },
    }
  },
}
