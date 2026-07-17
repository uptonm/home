#!/usr/bin/env bash
# Create a self-signed code-signing certificate for local `home` builds.
# Run once per developer machine — idempotent (won't recreate if present).
#
# After this runs the build codesigns with "Home CLI Dev" instead of ad-hoc.
#
# What this does NOT do: stop macOS asking for keychain access after a rebuild.
# The keychain ACL pins the grant to the exact binary, not to its signing
# identity, so a rebuild (new bytes → new cdhash) re-asks even though the
# designated requirement is unchanged. Verified empirically: two builds sharing
# `identifier home and certificate leaf = H"…"` still prompt separately.
#
# What signing is still worth: a stable identity for anything that *does* check
# the designated requirement, and one dialog rather than a fresh one per item.
# Secrets live in a single keychain entry, so that dialog is one, not one per
# module. Click 'Always Allow' (not 'Allow') so it sticks for that build.
set -euo pipefail

CERT_NAME="Home CLI Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$CERT_NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "✓ '$CERT_NAME' code-signing certificate already exists."
  exit 0
fi

WORK="$(mktemp -d)"
trap "rm -rf '$WORK'" EXIT

echo "Generating key + self-signed cert ($CERT_NAME)…"
openssl genrsa -out "$WORK/key.pem" 2048

openssl req -new -x509 \
  -key "$WORK/key.pem" \
  -out "$WORK/cert.pem" \
  -days 3650 \
  -subj "/CN=$CERT_NAME" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

P12_PASS="$(openssl rand -hex 12)"
openssl pkcs12 -export \
  -inkey "$WORK/key.pem" \
  -in "$WORK/cert.pem" \
  -out "$WORK/cert.p12" \
  -name "$CERT_NAME" \
  -password "pass:$P12_PASS" \
  -legacy

echo "Importing into login keychain…"
security import "$WORK/cert.p12" \
  -k "$KEYCHAIN" \
  -P "$P12_PASS" \
  -T /usr/bin/codesign \
  -A

# Let codesign use the private key without a dialog on every build. This needs
# the login keychain password: `-k ""` only works on a passwordless keychain, so
# fall back to letting `security` prompt for it on the terminal rather than
# silently leaving the partition list unset (which costs a GUI dialog per build).
PARTITIONS="apple-tool:,apple:,codesign:"
if security set-key-partition-list -S "$PARTITIONS" -s -k "" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "✓ codesign can use the key without prompting."
else
  echo
  echo "Enter your login keychain password so codesign can use the signing key"
  echo "without a dialog on every build (it is not stored):"
  if security set-key-partition-list -S "$PARTITIONS" -s "$KEYCHAIN" >/dev/null 2>&1; then
    echo "✓ codesign can use the key without prompting."
  else
    echo "⚠️  partition list not set — codesign will show a dialog per build."
    echo "    Click 'Always Allow' (not 'Allow') and it will stop asking."
  fi
fi

echo
echo "✓ Created '$CERT_NAME' code-signing identity."
echo "Run \`bun run build:mac\` (or \`bun run build:linux\`) and the binary will be signed."
echo "First secret access will prompt — click 'Always Allow' once per secret."
