import { runInstalledAppOAuth, readSharedGoogleClient, GOOGLE_MODULE } from '../../core/google-auth'
import { setSecret } from '../../core/secrets'
import { NotConfiguredError } from '../../core/errors'
import { DRIVE_SCOPES, MODULE_NAME, REFRESH_TOKEN_KEY, getAbout } from './client'

/**
 * Drive's setup is a browser consent, not a set of typed answers, so it
 * replaces the prompt-driven `runConfigure` via `ModuleManifest.configure`.
 */
export async function configureGdrive(): Promise<void> {
  // Not requireGoogleCredentials: that also demands a refresh token, which is
  // precisely what this function exists to obtain.
  const client = readSharedGoogleClient()
  if (!client) throw new NotConfiguredError(GOOGLE_MODULE, 'google_unconfigured')

  const tokens = await runInstalledAppOAuth({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scopes: DRIVE_SCOPES,
  })

  setSecret(MODULE_NAME, REFRESH_TOKEN_KEY, tokens.refreshToken)

  // Confirm the grant works end-to-end before declaring success.
  const about = await getAbout({ ...client, refreshToken: tokens.refreshToken })
  process.stderr.write(`authorized ${about.user?.emailAddress ?? '(unknown account)'}\n`)
}
