import type { CommandSpec } from '../../../core/types'
import { resetGoogleTokenCache, runInstalledAppOAuth } from '../../../core/google-auth'
import { setSecret } from '../../../core/secrets'
import {
  GCAL_MODULE,
  GCAL_REFRESH_TOKEN_KEY,
  GCAL_SCOPES,
  checkGcalStatus,
  getCalendarListEntry,
} from '../client'

export const authLogin: CommandSpec = {
  path: ['auth', 'login'],
  effect: 'destructive',
  description:
    'Authorize the CLI against your Google account (opens a browser) and store the refresh token. Run `configure` first to set clientId/clientSecret.',
  args: [
    { name: 'login-hint', kind: 'string', description: 'Pre-fill the account email on the consent screen' },
  ],
  examples: ['home gcal auth login', 'home gcal auth login --login-hint me@gmail.com'],
  async run(ctx) {
    const clientId = String(ctx.config.clientId ?? '')
    const clientSecret = String(ctx.config.clientSecret ?? '')
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        kind: 'config',
        message: 'clientId/clientSecret not set — run `home gcal configure` first',
        code: 'not_configured',
      }
    }

    const tokens = await runInstalledAppOAuth({
      clientId,
      clientSecret,
      scopes: GCAL_SCOPES,
      loginHint: ctx.args['login-hint'] ? String(ctx.args['login-hint']) : undefined,
    })

    // runInstalledAppOAuth guarantees a refresh token or throws.
    setSecret(GCAL_MODULE, GCAL_REFRESH_TOKEN_KEY, tokens.refreshToken)
    resetGoogleTokenCache()

    // Confirm the grant works end-to-end before declaring success.
    const primary = await getCalendarListEntry({ clientId, clientSecret, refreshToken: tokens.refreshToken }, 'primary')
    return {
      ok: true,
      data: {
        status: 'authenticated',
        account: primary.id,
        scope: tokens.scope,
      },
    }
  },
}

export const authStatus: CommandSpec = {
  path: ['auth', 'status'],
  effect: 'read',
  description:
    'Check the stored Google credentials with one bounded calendar-list request; reports the authenticated account or a stable failure code (not_configured / unauthorized / auth_failed / upstream_failed).',
  args: [],
  examples: ['home gcal auth status --json'],
  async run(ctx) {
    return checkGcalStatus(ctx.config)
  },
}
