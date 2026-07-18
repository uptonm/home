# Google credential setup

One Google Cloud project and one **Desktop-app** OAuth client serve every Google
module in this CLI — `gmail`, `gdrive`, and future ones like `gcal`. You set the
client up once under the shared `google` module, then authorize each module.

## Why a client ID is required at all

Google ships no first-party CLI for Gmail/Drive/Calendar, so any tool that reads
them must present its own OAuth client. `gmail.readonly` is a **restricted**
scope: an embedded, shared client covering it would need Google's CASA security
assessment. For a self-hosted, single-user CLI, bringing your own client is the
correct model — `rclone` works exactly the same way.

## Console steps

1. **Create a project** — <https://console.cloud.google.com/projectcreate>.
2. **Enable the APIs** you'll use — Gmail API, Google Drive API, and (optional,
   see below) Google Calendar API — under *APIs & Services → Library*.
3. **Configure the consent screen** — *APIs & Services → Google Auth Platform*.
   User type **External**.
4. **Publish to Production** (*Audience → Publish app*). This matters — see the
   callout below.
5. **Create the OAuth client** — *Credentials → Create credentials → OAuth client
   ID*, application type **Desktop app**. Keep the **Client ID** and **Client
   secret**.

### ⚠️ Publish to Production, or your logins die in 7 days

An External consent screen left in **Testing** status issues refresh tokens that
**expire after 7 days** — you'd have to re-authorize every module weekly.
Publishing to **Production** removes that expiry.

Production here stays *unverified*, which only means a 100-user lifetime cap and a
"Google hasn't verified this app" interstitial — both irrelevant for one user.
On that screen click **Advanced → Go to (unsafe)** to continue. Verification and
CASA are only required past 100 users.

See <https://developers.google.com/identity/protocols/oauth2#expiration> for the
exact rules.

## CLI steps

```bash
home google configure    # paste the Client ID + Client secret (once)
home gmail configure      # opens a browser to authorize Gmail
home gdrive configure     # opens a browser to authorize Drive
```

Each module's `configure` runs the browser consent and stores that module's own
refresh token. To sign out of every Google module in one step:

```bash
home google logout        # forgets gmail's and gdrive's refresh tokens
```

`logout` revokes nothing server-side and leaves the shared client configured —
re-run each module's `configure` to re-authorize.

## What breaks a working setup

These are the only real ongoing risks:

- **A Google password change revokes any refresh token containing Gmail scopes.**
  Re-run `home gmail configure`. Drive is unaffected — which is exactly why the
  tokens are kept per module rather than shared.
- **Six months of total inactivity** expires a refresh token.
- **Explicit revocation** at <https://myaccount.google.com/permissions>.

## Calendar

There is **no `gcal` module yet** (see `docs/gcal-module-plan.md`). Enabling the
Calendar API now only saves a second Console trip when it lands.
