---
plans: []
---

# Skill Generation

Every module in `apps/home` ships with a Claude skill, and nobody writes it. One
function turns a `ModuleManifest` into a Markdown file, two commands write that
file to disk, and the file is a build artifact of the source in exactly the way
a compiled binary is.

That is the sentence to check any proposed change against: **the manifest is the
input, `SKILL.md` is the output, and the output is overwritten on the next
install.**

## One function renders the whole file

`renderSkill` (`src/core/skill.ts:34`) is a single template literal — no
template engine, no partials, no per-module override hook. One string with three
helpers interpolated into it produces the entire document.

The consequence is uniformity, and uniformity is the point. Section order,
headings, and the wording of everything the manifest does not supply are
identical across every skill, so an agent that has read one `home-*` skill
already knows where to look in the next one. A per-module escape hatch would buy
expressiveness in one file and cost that guarantee in all of them.

The three helpers do the variable work: `commandInvocation`
(`src/core/skill.ts:10`), `commandsTable` (`src/core/skill.ts:17`), and
`examplesBlock` (`src/core/skill.ts:23`).

## Which manifest field lands where

Field definitions belong to [`005-MODULE-SYSTEM`](./005-MODULE-SYSTEM.md). This
is only the mapping, and it is the load-bearing part of the design: it is the
complete list of what an author can change about a generated skill.

| Manifest field | Where it lands |
| --- | --- |
| `name` | frontmatter `name: home-<name>`, the `# home-<name>` title, the `home <name> status` setup check, every command invocation, and both references to `home <name> configure` |
| `description` | frontmatter `description:` and the paragraph under the title |
| `commands[].path` | the invocation in each command-table row, joined by spaces after `home <name>` |
| `commands[].description` | the Purpose column of that row |
| `commands[].args` | positional args only, as `<name>` placeholders between the command and `[args]` |
| `commands[].examples` | flattened, in registry order, into the Examples block |
| `whenToUse` | the whole of `## When to use this skill`, verbatim, as the final section |

Everything else on the manifest is invisible to the renderer. `configSchema`
does not appear — setup is described as "run `home <name> configure`" and
nothing more, because that command is interactive and an agent cannot drive it,
so enumerating its fields would only invite an agent to try. `status` supplies
no text either; the skill hands the agent the *command* and the exit codes to
interpret. Non-positional args are never enumerated: every table row ends
`[args] --json`, and an agent that needs the flags runs `--help` against a
binary that cannot be out of date with itself.

`effect` (`src/core/types.ts:31-37`) also never reaches the file, so a generated
skill carries no machine-readable read/write/destructive signal. What warns an
agent off a destructive command is the prose in `description` and `whenToUse`;
the mechanical guard is the e2e harness refusing to execute it, not the skill.

## The shape of the rendered file

The blocks are fixed, and so is their order (`src/core/skill.ts:35-78`).

It opens with YAML frontmatter carrying `name: home-<module>` and the module
description, which is the pair Claude Code indexes a skill by. The title repeats
the name, the description repeats below it, and then one standing sentence tells
the agent that `home` persists credentials locally so it can call commands
without asking the user for tokens — the single most important thing a skill can
say, since the alternative behaviour is an agent stopping to ask for an API key
that is already in the keyring.

`## Setup check` gives `home <module> status` and reads its exit codes for the
agent: 0 is ready, 3 means not configured and the *user* must run
`home <module> configure`, which is interactive and, the file says outright,
cannot be driven by the agent.

`## Commands` is the table. `commandInvocation` renders each row as
`` `home <module> <path…> <positionals> [args] --json` `` — a backticked, ready
to paste invocation rather than a bare name — and it appends `--json` to every
row it generates (`src/core/skill.ts:14`). Every documented call is therefore a
JSON call; the reasoning, and what that implies for the human renderer, is in
[`000-CLI-OUTPUT-CONTRACT`](./000-CLI-OUTPUT-CONTRACT.md). A paragraph below the
table repeats that `--json` is available and that default output is short
tables.

`## Examples` is one `bash` fence holding every example string from every
command, concatenated in registry order with no per-command heading, because the
strings are already full invocations and reading them top to bottom is the
fastest way for an agent to pattern-match. A module with no examples anywhere
renders the literal `_No examples yet._` instead of an empty fence
(`src/core/skill.ts:30`).

`## Exit codes` lists 0/1/2/3 with the same meanings the whole CLI uses
([`000-CLI-OUTPUT-CONTRACT`](./000-CLI-OUTPUT-CONTRACT.md)); the skill restates
them because it is read in isolation by an agent that has no other view of the
contract. `## When to use this skill` closes the file with `whenToUse`
unmodified.

## Where the files land

`src/core/paths.ts:37-41` fixes the location:

- `skillsDir` — `~/.claude/skills`
- `skillDir(module)` — `~/.claude/skills/home-<module>`
- `skillFile(module)` — `~/.claude/skills/home-<module>/SKILL.md`

These three resolve against `homedir()` alone. The config, secrets, and cache
paths beside them all route through `XDG_CONFIG_HOME`, deliberately, so tests
can redirect writes into a throwaway directory (`src/core/paths.ts:4-9`). The
skill paths do not, because the directory Claude Code scans is not configurable
from here — pointing them elsewhere would produce a file nothing reads.
`skillDir` is exported for symmetry and currently has no caller; `skillFile` is
what the writer uses.

## Two commands write them

`writeSkill` (`src/core/skill.ts:81`) renders one manifest, creates the parent
directory if it is missing, and `writeFileSync`s the whole file, returning the
path. `writeAllSkills` (`src/core/skill.ts:88`) ensures `skillsDir` exists and
maps `writeSkill` over the manifests it is handed.

Two surfaces call them:

`home skill install` (`src/commands/skill.ts:10-24`, wired at
`src/index.ts:49`) passes the whole registry to `writeAllSkills` and emits the
array of written paths. Because that array is strings rather than objects,
`formatHuman` prints one path per line (`src/core/output.ts:41-61`), which is
the human-readable receipt for the install. It declares only `--json`
(`src/commands/skill.ts:6-8`); unlike a module leaf command it takes no
`--quiet` or `--verbose`.

`home <module> skill` regenerates a single module. It is synthesized by
`makeSkillCommand` (`src/core/citty.ts:207-218`) and installed on every module
alongside `configure` and `status` (`src/core/citty.ts:236-240`), so it exists
whether or not a module author thought about it. It emits `{ path }`. Shell
completion mirrors both surfaces (`src/core/completion.ts:82-84` and
`152-157`), each carrying a comment that it must stay in sync with the command
tree.

Writing is whole-file and unconditional: there is no merge, no patch, and no
read of the existing file. The same manifest therefore always produces a
byte-identical result, which is what makes running `home skill install` after
every change cheap enough to be unconditional. It is also purely additive —
nothing prunes. A module deleted from `src/registry.ts` leaves its
`~/.claude/skills/home-<module>/` directory behind, still describing commands
the binary no longer has.

## Generated, therefore never hand-edited

`~/.claude/CLAUDE.md` states the rule: a `SKILL.md` under `~/.claude/skills/` is
written from a `ModuleManifest` and editing one by hand is pointless, because
the next install overwrites it. The instructions there also state the
obligation that follows — any change to a module's commands, flags, or docs ends
with:

```bash
bun run build:install && home skill install
```

Both halves matter, and the order is the reason. `home skill install` runs the
binary on `PATH`, and that binary has the manifests compiled into it; it does
not read the working tree. Running `home skill install` after editing a manifest
but before rebuilding regenerates every skill from the *old* manifests and
produces a confidently wrong file. Build mechanics are in
[`010-BUILD-AND-DISTRIBUTION`](./010-BUILD-AND-DISTRIBUTION.md).

## The drift this prevents

Skipping the regeneration step produces one of two failures, and neither
announces itself.

The first is a stale skill: the manifest gained, lost, or renamed a command, and
the installed file still describes the old surface. The agent reads the table,
calls a command that no longer parses, and gets exit 1 — or never learns about
a command that exists. Nothing in the file is timestamped or versioned, so the
skill looks exactly as authoritative as a fresh one.

The second is a module in `src/registry.ts` with no directory under
`~/.claude/skills/` at all: the CLI can do the work and no agent knows it can.

Neither failure is detected. `src/__tests__/smoke.test.ts:48-54` renders every
manifest through `renderSkill` and asserts the output does not throw and carries
its frontmatter and `## When to use this skill` heading, which proves the
template survives every manifest in the registry — but it compares nothing
against disk. No test, no CI step, and no command reports that an installed
skill has fallen behind its manifest. The rule above is the entire enforcement
mechanism, which is why it is stated as unconditional rather than as a judgement
call.

## The renderer escapes nothing

Manifest strings are interpolated raw, and two positions are structural:
`description` becomes an unquoted YAML scalar in the frontmatter, and each
command `description` becomes a Markdown table cell. A description containing a
`|`, a newline, or a leading YAML-significant character produces a broken file
rather than an error, so those constraints fall on the manifest author and
nothing checks them.

`commandInvocation` also renders every positional as `<name>`
(`src/core/skill.ts:12`) without consulting `required`. `home sonos groups
party` declares `room` as `required: false`
(`src/modules/sonos/commands/groups.ts:164`) and its own examples show the
command run with no room at all, yet its table row reads
`` `home sonos groups party <room> [args] --json` ``. The examples block is what
corrects the impression, which is a good reason for every command to carry one.
