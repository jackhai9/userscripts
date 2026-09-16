# Test selection

The affected-test runner selects complete Node test files and Playwright specs from
the current repository inventory. It combines verified dependency edges with every
consumer whose runtime dependencies cannot be proved. Unknown readers remain in
the plan even when another test is already known to consume a changed file.

## Commands and scope

| Scope | Command | Purpose |
| --- | --- | --- |
| Test policy | `npm run lint:tests` | Enforce the executable test-policy rules independently of test selection. |
| Affected behaviors | `npm run test:affected` | Run affected files and all uncertain consumers after local changes. |
| Complete behaviors | `npm run test:affected -- --full` | Run every discovered Node test and Playwright spec. |
| Complete source coverage | `npm run test:coverage` | Collect the full Node and Chromium coverage run and enforce its coverage policy. |

Use the Node version in `.nvmrc`, for example with `nvm use`, before invoking these
commands. The selector checks the exact running Node version and uses
`process.execPath` for child processes. Lint is a separate command; selection never
silently runs or substitutes for test lint. L0/L1/L2 retain their runtime meanings
from the UI automation manual: Node core, JSDOM, and Playwright respectively.
See [test policy](test-policy.md) and
[coverage](test-coverage.md) for their respective contracts.

## Commands and change discovery

Run the commands from the repository root:

```sh
npm run test:affected
npm run test:affected -- --base origin/main
npm run test:affected -- --full
node scripts/test-selection/run.mjs --list
npm run --silent test:affected -- --base origin/main --list
```

Without `--base`, the selector compares the working tree with `HEAD`. It resolves
the base to an available commit, collects `git diff --name-only --no-renames -z`
against that commit, and includes untracked paths from Git. The inventory also
includes untracked tests and excludes tracked files that no longer exist.
NUL-delimited Git output preserves spaces and newlines in filenames. A rename
retains both the old deletion and the new addition in the changed-path set.

`--base REF` compares against the supplied commit rather than assuming a CI
event's previous SHA exists locally. Missing arguments, all-zero bases,
unavailable commits, an unborn `HEAD`, and unknown or repeated options fail
explicitly. `--full` still requires valid repository state and a resolvable base.
Neither an invalid base nor failed discovery becomes an empty successful plan.

`--list` prints only the JSON plan and does not run tests. Use npm's `--silent`
option when parsing npm output, since npm otherwise adds its own banner. Store
captured plans under the ignored `test-results/` directory so the output does not
become a new unmapped input to the next selection.

The JSON interface is versioned:

```json
{
  "schemaVersion": 1,
  "mode": "affected",
  "reasons": ["Selected complete test files through dependency edges and all unresolved consumers"],
  "changedFiles": ["src/example.js"],
  "nodeTests": ["test/unit/example.test.js"],
  "browserTests": []
}
```

`mode` is `none`, `affected`, or `full`. Path arrays contain sorted,
repository-relative filenames. `reasons` explains selection and any uncertainty;
consumers should use `mode` and the path arrays rather than parse diagnostic text.

An actual run prints a plan summary, runs the selected Node files first, and then
runs the selected Playwright specs. A failed runner stops the sequence. Commands
use argument arrays without a shell. Node uses the programmatic `run({ files })`
interface because its CLI interprets positional filenames as glob patterns.
Playwright's filename filters are escaped and suffix-anchored because its CLI
interprets those filters as regular expressions. Selection is by whole file,
never by individual test title.

## Dependency evidence

The test roots are:

- `test/unit/**/*.test.js`
- `test/dom/**/*.test.js`
- `e2e/**/specs/**/*.pw.js`, including specs nested below the specs directory

The Playwright configuration must expose a static `testDir` under
`e2e/.../specs` and the recursive `testMatch: '**/*.pw.js'` contract. The parser
supports the exported object directly or its `defineConfig(...)` wrapper.

Acorn parses local static imports, exports, literal dynamic imports, static
`new URL(..., import.meta.url)` expressions, and literal paths that match inventory
files. URL references follow URL encoding rules, including encoded spaces and
newlines. Literal URL strings, templates without substitutions, and literal string
concatenation can be resolved without runtime value analysis.

Generated userscripts inherit the `entry` declared for their `output` in the
exported `TARGETS` object in `scripts/build-userscript.mjs`. Dependencies then
continue through the source entry and its shared modules. The selector does not
execute the builder or hand-maintain a second artifact-to-source mapping.
Unsupported, unsafe, duplicate, or unavailable build mappings prevent a partial
plan from claiming that the artifact graph is complete.

Snapshot ownership follows the verified Playwright template:

```js
snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}'
```

For example, `specs/nested/panel.pw.js-snapshots/panel.json` belongs to
`specs/nested/panel.pw.js`. This edge does not require a literal snapshot filename
inside the spec. Other snapshot layouts are not assumed to have equivalent
ownership rules.

## Uncertainty and full runs

A module that imports `fs`, `fs/promises`, `child_process`, or `module`, with or
without the `node:` prefix, always has uncertain runtime dependencies. This also
applies to literal dynamic imports of those modules and CommonJS loaders. Static
paths in such a module still add useful edges, but never remove its uncertainty.
This intentionally retains readers accessed through aliases, destructuring,
shadowed parameters, `createRequire`, subprocesses, and directory scans. A module
that only writes files can therefore select more tests than strictly necessary.

Nonliteral dynamic imports, runtime URL expressions, unsupported executable
dependencies, missing referenced files, and opaque URL module imports also retain
their complete test consumers. Finite-looking arrays are not treated as immutable
path domains: mutation, aliasing, and function calls can change the values used by
a template. If a template-derived resource has no independently verified edge,
changing it still requires a full run.

Uncertainty records carry explicit `file`, `reason`, and `scope` fields internally.
Consumer-scoped records propagate through reverse dependencies to every owning
test root. Every nonempty change set, including documentation changes, selects
those complete files. Independently verified affected consumers are then added.
Tests outside both sets can be omitted.

A full run is selected when:

- `--full` is requested.
- Package manifests or lockfiles, `.nvmrc`, workflows, Playwright configuration,
  ESLint configuration, the userscript builder, or `scripts/test-*` infrastructure
  changes.
- A changed path was deleted, is unavailable, or has no verified consumer and is
  not an eligible documentation file. Unmapped JSON, HTML, images, snapshots, and
  source files all remain runtime changes.
- Build mapping, Playwright discovery, or snapshot ownership cannot be verified
  globally, or an uncertain dependency cannot be assigned to a test owner.

A failed file read or Git operation is an explicit command failure rather than a
successful empty result. Protected configuration and credential paths are never
read by graph construction; their presence as changed filenames can still require
a full run.

`none` is allowed for a valid graph with no changes, or for documentation without
known or uncertain runtime consumers. Eligible documentation is Markdown under
`docs/` and the documented root Markdown names such as `README.md` and `AGENTS.md`.
A Markdown extension alone is not enough to skip a runtime reader.

The selector does not generate userscripts, install them, activate live browser
sessions, or authorize financial actions. Its browser execution is the project's
configured Playwright test suite; manual or live validation remains a separate
project requirement.
