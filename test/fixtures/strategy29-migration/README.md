# Released migration fixture

`legacy-0.3.0.user.js` is the exact published Strategy29 0.3.0 artifact from
userscripts PR #277. SHA-256:
`e596ee8fb971cda4307205349182eb05b44b461c9193c2b8693ef4fc71009e2a`.

It is immutable test input, not an install entry or editable implementation.
The generated-client tests execute this historical remote owner to reproduce
independently scheduled Tampermonkey upgrades and verify that the unified client
does not replace its panel or start a second remote consumer.

`host-0.5.1.user.js` is the exact Strategy27 artifact from PR #284:
`2f8d55718c99f1fda6af37855b2904d58dcf75ab5ed32ad33fe8511ea969526c`.
`local-0.4.1.user.js` is the exact Strategy29 artifact installed with PR #283:
`ffe79ecd2e23c198ba517602e4ef4d05f8cbfc0b7d324509114900615b9d2429`.
These immutable fixtures verify both staged upgrade orders without duplicate
panel ownership or private credential migration.
