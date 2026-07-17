#!/usr/bin/env bash
# Build the home binary for the host platform and codesign with the local
# "Home CLI Dev" identity (if present) so macOS Keychain ACLs persist across
# rebuilds. On Linux this just runs the bun build — codesign is macOS-only.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUTFILE="${1:-$REPO/dist/home}"
TARGET="${HOME_BUILD_TARGET:-}"

# Make sure bun is discoverable even when invoked from a non-interactive shell.
if ! command -v bun >/dev/null 2>&1; then
  for d in "$HOME/.bun/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
    if [[ -x "$d/bun" ]]; then export PATH="$d:$PATH"; break; fi
  done
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found on PATH" >&2
  exit 1
fi

if [[ -z "$TARGET" ]]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) TARGET="bun-darwin-arm64" ;;
    Darwin-x86_64) TARGET="bun-darwin-x64" ;;
    Linux-x86_64|Linux-amd64) TARGET="bun-linux-x64-baseline" ;;
    Linux-aarch64|Linux-arm64) TARGET="bun-linux-arm64" ;;
    *) echo "unsupported host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
fi

VERSION="$(node -e "console.log(require('$REPO/package.json').version)")"
COMMIT="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo dev)"
if ! git -C "$REPO" diff --quiet 2>/dev/null; then COMMIT="${COMMIT}-dirty"; fi

mkdir -p "$(dirname "$OUTFILE")"

bun build --compile --target="$TARGET" \
  --define "__HOME_VERSION=\"$VERSION\"" \
  --define "__HOME_COMMIT=\"$COMMIT\"" \
  "$REPO/src/index.ts" \
  --outfile "$OUTFILE"

# Codesign on macOS when our self-signed dev identity is in any keychain.
# `find-identity -v` excludes self-signed certs (they lack trust), so we
# probe with `find-certificate` instead — codesign can still use the cert
# regardless of trust state.
if [[ "$(uname -s)" == "Darwin" ]] && \
   security find-certificate -c "Home CLI Dev" >/dev/null 2>&1; then
  codesign --force --sign "Home CLI Dev" "$OUTFILE"
  echo "✓ codesigned with 'Home CLI Dev'"
else
  echo "ℹ️  no 'Home CLI Dev' cert — binary stays ad-hoc signed."
  echo "    (run scripts/setup-codesign.sh once to enable stable signing)"
fi

echo "✓ built $OUTFILE  ($VERSION $COMMIT)"
