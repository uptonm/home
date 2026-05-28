#!/usr/bin/env bash
# Create a self-signed code-signing certificate for local `home` builds.
# Run once per developer machine — idempotent (won't recreate if present).
#
# After this runs:
#   1. The build will codesign with "Home CLI Dev"
#   2. On first codesign use, macOS prompts for keychain access — click Always Allow
#   3. On first `home <cmd>` run, macOS prompts to read each secret — click Always Allow
#   4. After that, rebuilds reuse the same signature → no more prompts
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

# Allow codesign + system tools to use the private key without password prompts.
# Needs the keychain password; if we can't set it non-interactively, you'll be
# prompted once on first codesign use, which is fine.
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || true

echo
echo "✓ Created '$CERT_NAME' code-signing identity."
echo "Run \`bun run build:mac\` (or \`bun run build:linux\`) and the binary will be signed."
echo "First secret access will prompt — click 'Always Allow' once per secret."
