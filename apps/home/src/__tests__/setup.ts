import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Test preload (see bunfig.toml): runs before any test file's module scope
// evaluates. `paths` (src/core/paths.ts) reads XDG_CONFIG_HOME lazily, but a
// default still has to point somewhere before any per-test override kicks
// in — this ensures that default is always a throwaway directory, never the
// developer's real ~/.config/home, no matter which test file happens to
// touch config/secrets first or forgets to isolate itself.
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-test-'))
