# Deployment of the pinned NHI Explorer consumer

This consumer is deployed together with the parent NHI demonstration, under `shared-explorer/dist/`. Follow the [parent deployment notes](../../docs/deployment.md).

Run `npm run verify` in this package before a release, then build the parent site. Keep the full dist directory and its attribution; the host HTML alone is insufficient. Use relative paths so `/nhi-pulley-demo/` works on GitHub Pages.

Serve over HTTP(S), with normal GLB, binary, JSON and gzip downloads. The runtime handles its prepared gzip assets; do not label their bytes as already decompressed. The host / child controller derives and validates the exact origin and session.

Check the three inspection themes, source attribution, drawing fallback and responsive host on the deployed repository path. The authored pulley has no operating or exploded-assembly capability. Do not infer manufacturer fit or measured device performance from a successful web deployment.

Only redistributable illustrative geometry and public catalog references belong in this consumer. There is no account, credential or customer-record service.
