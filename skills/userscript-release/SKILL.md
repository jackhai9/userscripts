---
name: userscript-release
version: 1.0.0
description: Bump versions, run checks, prepare release commit.
---

# userscript-release

Use this skill when shipping changes in this repository.

## Workflow

1. Read `AGENTS.md` first.
2. For every changed file under `scripts/`, bump its `@version`.
3. Verify `@updateURL` and `@downloadURL` still point to this repo's raw GitHub URL.
4. Run `node --check` on each changed userscript.
5. Summarize what changed, what was verified, and what was not tested.
6. If asked to commit or push, use a concise message that reflects user-facing impact.

## Release Checklist

- `@version` updated for every changed userscript
- syntax check passed
- no accidental source-of-truth drift in `README.md`
- final summary includes residual risks when browser hand-testing was skipped

## Notes

- This repo does not have a real automated test suite; do not pretend `node --check` is enough.
- If a change only touches docs or non-script files, version bump is not required.
