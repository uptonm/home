import type { CommandSpec, ModuleManifest } from '../../core/types'
import { GOOGLE_MODULE, readSharedGoogleClient, resetGoogleTokenCache } from '../../core/google-auth'
import { deleteSecret, getSecret } from '../../core/secrets'

/** Google modules that authorize against the shared client, in setup order. */
const GOOGLE_API_MODULES = ['gmail', 'gdrive'] as const

/** Secret key every Google module stores its refresh token under. */
const REFRESH_TOKEN_KEY = 'refreshToken'

const logout: CommandSpec = {
  path: ['logout'],
  effect: 'destructive',
  description:
    "Forget every Google module's stored refresh token (gmail, gdrive) — revokes nothing server-side; re-run each module's `configure` to re-authorize. The shared OAuth client stays configured.",
  args: [],
  examples: ['home google logout'],
  async run() {
    const cleared: string[] = []
    for (const module of GOOGLE_API_MODULES) {
      if (getSecret(module, REFRESH_TOKEN_KEY)) {
        deleteSecret(module, REFRESH_TOKEN_KEY)
        cleared.push(module)
      }
    }
    resetGoogleTokenCache()
    return { ok: true, data: { status: 'logged_out', cleared } }
  },
}

export const manifest: ModuleManifest = {
  name: GOOGLE_MODULE,
  description: 'Shared Google OAuth client credentials used by gmail, gdrive, and future Google modules',
  whenToUse:
    'Use to set up the one OAuth client every Google module shares. Run `home google configure` once with a Google Cloud "Desktop app" client ID/secret, then authorize each module with `home gmail configure` / `home gdrive configure`. `home google logout` forgets every module\'s grant in one step. See docs/google-setup.md for the Cloud Console walkthrough — in particular, the OAuth app must be published to Production or its refresh tokens expire after 7 days.',
  configSchema: [
    {
      key: 'clientId',
      label: 'Google OAuth Client ID',
      kind: 'string',
      required: true,
      help: 'From a Google Cloud "Desktop app" OAuth client — see docs/google-setup.md',
    },
    {
      key: 'clientSecret',
      label: 'Google OAuth Client Secret',
      kind: 'secret',
      required: true,
      help: 'The "Client secret" shown next to the Desktop-app OAuth client',
    },
  ],
  commands: [logout],
  async status() {
    // No network call is possible here: a client id/secret authenticates the
    // Cloud project, never a user, so nothing is reachable without a grant.
    // What is worth reporting is which modules actually hold one.
    const client = readSharedGoogleClient()
    const authorized = GOOGLE_API_MODULES.filter((m) => getSecret(m, REFRESH_TOKEN_KEY))
    return {
      ok: true,
      data: {
        status: client ? 'configured' : 'not configured',
        clientId: client?.clientId ?? null,
        authorized,
        unauthorized: GOOGLE_API_MODULES.filter((m) => !authorized.includes(m)),
      },
    }
  },
}

export default manifest
