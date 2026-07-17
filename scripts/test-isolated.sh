#!/usr/bin/env bash
# Run each test file in its own bun process.
#
# Why: bun's `mock.module()` is process-global and has no teardown — a mock
# installed at module scope in one file applies to every other file in the run,
# and bun evaluates every test file's module scope before running any test. So
# the command tests that mock a client module (e.g. gmail-messages.test.ts) hijack
# the module for the tests that exercise the real one (gmail-client.test.ts),
# which then fail purely because of who else is in the run.
#
# `--isolate` / `--parallel` don't help: they run each file against fresh globals
# in a way that breaks top-level-await imports in the sonos suites.
#
# Every file passes on its own, so give each one a clean process. Costs ~1s.
#
# Pass any argument to delegate straight to `bun test` (e.g. a single file).
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [[ $# -gt 0 ]]; then
  exec bun test "$@"
fi

# Avoid `mapfile` — macOS still ships bash 3.2, where it doesn't exist.
FILES=()
while IFS= read -r line; do
  FILES+=("$line")
done < <(find src -name '*.test.ts' | sort)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "no test files found" >&2
  exit 1
fi

FAILED=()
for f in "${FILES[@]}"; do
  if ! bun test "$f" >/dev/null 2>&1; then
    FAILED+=("$f")
  fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo
  echo "✗ ${#FAILED[@]} of ${#FILES[@]} test files failed:"
  for f in "${FAILED[@]}"; do
    echo
    echo "─── $f ───"
    bun test "$f" 2>&1 | tail -30
  done
  exit 1
fi

echo "✓ all ${#FILES[@]} test files passed (each in its own process)"
