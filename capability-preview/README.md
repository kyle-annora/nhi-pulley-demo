# Patrick capability-preview snapshot

Portable local snapshot of the existing Annora Explorer / Studio demonstration, copied from the `annora-explorer` build at source commit `bc53527164c5a18268a5dbd6f4cd01d21e2be9b4`. This is a **separate crank / platform sample**, not the F-4412 model or an NHI integration.

Source project: [Annora Explorer](https://github.com/kyle-annora/annora-explorer) at the pinned commit above. The copied runtime and model assets are unchanged; `snapshot-provenance.json` records the adapted entry pages. Preserve `LICENSES.txt` and all source / model credits. The snapshot contains approximately 86 MB so its model, drawing and application assets do not depend on a separately hosted page.

Serve this folder as part of the NHI demo over HTTP. Relative asset paths are retained; no second origin or server is required. The parent Patrick component loads one iframe at a time and removes the previous application when changing previews or returning to NHI.

## Local record isolation

Each application entry loads `storage-isolation.js` before its gated module import. The adapter exposes the Storage API using the `nhi-patrick-capability-v1:` prefix for localStorage and sessionStorage. Key enumeration and clear are restricted to this namespace. Drawing IndexedDB names are also prefixed; storage events from other namespaces are ignored. A failed adapter prevents the application entry module from running rather than falling back to unprefixed writes.

This is a persistence namespace adapter for the demonstration, not a cross-origin security sandbox. It changes only the copied page's window, and never rewrites existing NHI / Annora records. The maintained upstream source and NHI's pinned shared Explorer are untouched. Focused regression tests live at `tests/patrick-capability-storage.test.mjs`.

Studio saves and publishes fictional content only inside the namespaced browser demo. It does not deploy a website, send a request to NHI, issue an authorized offer or create an order. This preview does not transfer product content, model identity or quotations to the F-4412 presentation.

The snapshot retains the platform's wider product selector and tools. The prepared crank is the recommended presentation path. Other models keep their original authorship / capability limits; authored movement should not be claimed for every model. Live browser verification is owned by the parent NHI delivery, not asserted by this snapshot copy.
