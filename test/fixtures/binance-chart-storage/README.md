# Binance chart-storage source fixtures

These public source snapshots are test inputs for an isolated chart-storage
prototype. They are not userscripts, application startup scripts, or production
assets. Do not import them from `src/`, add them to userscript builds, or execute
them on a real Binance page. The repository build targets are explicit `src/`
entrypoints and do not include this fixture directory.

## Files and provenance

- `webpack-runtime.js` is the exact, unformatted response body from
  <https://bin.bnbstatic.com/static/webpack-runtime.ea82941e.js>. It identifies its
  bundler as Rspack 1.7.11 and implements the webpack-compatible
  `self.webpackChunkfutures_trade_ui` chunk interface.
- `localforage-module.js` contains the complete original module `43917` method
  factory from <https://bin.bnbstatic.com/static/main.37a180b9.js>. Its inline
  localForage 1.10.0 / Mozilla / Apache License 2.0 notice is preserved verbatim.
  The only surrounding code is a registration-only chunk with the string ID
  `codex-chart-storage-fixture` and the original module ID `43917`.
- `manifest.json` records retrieval timestamps, source URLs, SHA-256 checksums,
  byte counts, extraction offsets, dependency inspection, and verification.
  The full main bundle was a temporary extraction input and is not retained.

Retrieved on 2026-10-06 UTC. These snapshots establish that dated public source
contract; they do not establish which bundle a later live page has loaded.

## Extraction contract

Python's `urllib.request.urlopen` retrieved both public URLs without reading any
credential files. Acorn 8.18.0 parsed the main bundle as an ECMAScript script. The
extractor selected the unique numeric property `43917` in the first chunk push's
module map and copied its original source range. It did not match braces with a
regular expression or regenerate/minify the factory.

The manifest ranges are zero-based UTF-16 string offsets with exclusive ends,
matching Acorn and JavaScript `String.prototype.slice`. `module_property_sha256`
checks the entire original `43917(_,y,e){...}` property.
`factory_sha256` checks Acorn's function value range, `(_,y,e){...}`, without the
numeric property key. Both hashes use the UTF-8 encoding of those exact source
slices. `fixture_sha256` includes the new registration wrapper. The runtime hash
checks downloaded bytes without transformation.

The fixture payload has exactly two elements: chunk IDs and the module map. It
contains no third runtime callback and no module require. The string chunk ID was
absent from both downloaded source files, including the runtime's existing chunk
maps.

## Runtime and dependency boundaries

Load the runtime and then the module fixture only in a fresh, isolated test
context with an empty chunk queue. Registration adds the factory without
executing it. The real runtime can later supply its require function through a
separate test-owned chunk callback; explicitly requiring `43917` is a distinct
step owned by the test harness.

The factory imports no external webpack modules. It reads the third parameter's
`g` property four times to obtain the global object for its bundled Browserify
code. Preserve that real runtime contract; do not substitute an empty object for
the webpack require argument. Browserify's modules are contained in the factory;
its loader also contains the original missing-module `require` fallback.

On an empty queue, the runtime installs module/chunk registration, deferred
execution, and JS/CSS loading helpers. It does not start an application or load a
chunk. It does process any preexisting queue, including runtime callbacks, so
these files must not be injected into an existing page. The loader helpers retain
their upstream network capabilities; isolation and network blocking belong to
the test harness.

Acorn scope inspection found exactly four references to the webpack parameter,
all reading `.g`, and no external webpack require calls. A bounded Node VM check
loaded the unmodified runtime, captured its real require in a test-owned empty
chunk, and registered the fixture. It observed only module ID `43917`, zero
factory invocations, and zero DOM, storage, network, or timer accesses. The check
used failing accessors for those boundaries and a counting module-registration
proxy. No localForage factory, browser, real page, or database was executed during
fixture acquisition. Browser behavior and storage migration must be verified by
the separate offline harness.
