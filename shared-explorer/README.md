# NHI F-4412 shared Explorer

This is an isolated, pinned consumer of the actual Annora Explorer runtime.
The upstream project is not modified. `src/explorer/` is copied verbatim from
`f077210f79635dbd8e4ec9f66511a6cfc2c5f174` of Annora Explorer. NHI owns the
project configuration, model package, optional embed presentation and host adapter.

## Integration

NHI loads `shared-explorer/dist/` in one iframe and sends JSON commands through
`src/shared-explorer-client.js` in the parent application. The protocol validates
exact origin, source window and session. No Three.js objects cross the boundary.

Identifiers:

| Object | ID |
| --- | --- |
| Model / root | `f4412` |
| Tour | `f4412-inspection` |
| Inspection regions and chapters | `belt`, `flange`, `mount` |

`explorerURL()` supplies `embed=1`, the exact `parentOrigin`, and `host=nhi`.
The host presentation suppresses duplicate product/inspection panels inside the
iframe. It preserves the shared scene and native overview/reverse/display
controls during free inspection, and the provenance dialog. NHI provides the
three chapter controls, explanation, catalog source and inquiry actions outside
the canvas. Removing `host=nhi` restores the original floating Explorer shell.

The parent wrapper waits for the geometry-ready public lifecycle, checks tour
capability, serializes rapid chapter choices and handles terminal command errors.
Unmounting removes subscriptions and closes/disposes the iframe client.

## Content evidence

`source/generate.mjs` creates the original illustrative GLB. It preserves the
catalog dimensions A = 3.125 in, B = 2.75 in, D = 0.75 in. Stamped contours,
hub and seals are reconstructed illustrations. This is not manufacturer CAD.
The six meshes are grouped into three inspection regions, not a verified BOM.
The source model has no animation. Explosion and operating capabilities are
disabled in project policy, including the public controller API.

The source for A/B/D is the NHI Idler & Drive Pulleys catalog, page 6, already
referenced in the parent demo. Bore, offsets, spacers, fit, speed and load remain
engineering questions. Looking at a region never confirms a requirement.

The tour is visitor-paced and coordinates camera, highlight, selection and
captions. Reduced-motion visitors receive stable chapter views. There is no
fabricated assembly separation or operating motion.

## Build and verify

```sh
npm ci
npm run verify
```

The build uses relative URLs and is served by the parent NHI preview server.
The complete `dist/` folder is required; the parent's HTML alone is insufficient.

To reproduce a new model revision, run `npm run generate:model`, then use the
generic importer with a **new review directory**, update the project manifest
path and verify before replacing the currently served package:

```sh
npm run import:model -- --source source/model.glb --definition source/import-definition.json --out content/models/f4412-review
```

The importer refuses overwrite and preserves the original GLB bytes. Runtime
transport tests cover origin/session rejection and lifecycle cleanup. F-4412
tests check policy boundaries, deterministic tour states, preserved source and
catalog geometry envelopes. Desktop/mobile interaction is verified in the parent
NHI acceptance walkthrough; no device-performance claim is made here.

## Attribution

The shared runtime and this original illustrative model are MIT licensed.
`dist/LICENSES.txt` carries runtime, Three.js and model notices. No customer data
or quotation records are stored in this package. It has no seller backend.
