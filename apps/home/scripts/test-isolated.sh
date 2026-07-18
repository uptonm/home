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
# Usage:
#   scripts/test-isolated.sh                     # discover + run every test file
#   scripts/test-isolated.sh a.test.ts           # one file: delegate to bun test
#   scripts/test-isolated.sh a.test.ts b.test.ts # several: each in its own process
#
# Flags are rejected on purpose: `bun test --coverage` (or any flag) would run
# the whole suite in one process and reintroduce the exact leakage this script
# exists to prevent.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

FILES=()

if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    if [[ ! -f "$arg" ]]; then
      echo "test-isolated.sh: '$arg' is not a test file." >&2
      echo "Flags and glob patterns are not supported: bun would run the whole suite in" >&2
      echo "one process, where mock.module() leaks across files. Pass explicit file" >&2
      echo "paths, or run 'bun test' directly if you accept shared-process semantics." >&2
      exit 1
    fi
  done
  if [[ $# -eq 1 ]]; then
    exec bun test "$1"
  fi
  FILES=("$@")
else
  # Match bun's own discovery (.test / _test / .spec / _spec × js/jsx/ts/tsx,
  # anywhere in the repo) so a file bun would run can never be silently skipped
  # here. Avoid `mapfile` — macOS still ships bash 3.2, where it doesn't exist.
  while IFS= read -r line; do
    FILES+=("$line")
  done < <(
    find . \( -name node_modules -o -name .git -o -name dist \) -prune -o \
      -type f \( \
        -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.test.js' -o -name '*.test.jsx' -o \
        -name '*_test.ts' -o -name '*_test.tsx' -o -name '*_test.js' -o -name '*_test.jsx' -o \
        -name '*.spec.ts' -o -name '*.spec.tsx' -o -name '*.spec.js' -o -name '*.spec.jsx' -o \
        -name '*_spec.ts' -o -name '*_spec.tsx' -o -name '*_spec.js' -o -name '*_spec.jsx' \
      \) -print | sort
  )
fi

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
