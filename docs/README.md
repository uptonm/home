# docs/

```
specs/    what is true — source of truth, maintained forever
plans/    a change that makes a spec true — written once, never removed
```

The convention — numbering, frontmatter, and the `NEEDS APPROVAL` / `PLANNED` /
`REMOVING` markers — lives in `~/.claude/CLAUDE.md` and is not restated here.

**Every plan enters at `NEEDS APPROVAL`**, with a do-not-execute banner and its
spec passages marked to match. Nothing is executed from that state. Approval is
the one thing that promotes those markers to `PLANNED` and removes the banner,
and it is granted per plan rather than per pull request.

Rejecting deletes the spec passage and leaves the plan in place, unexecuted, as
the record of what was considered.

Every plan currently in `plans/` has been approved and is marked `PLANNED`.
