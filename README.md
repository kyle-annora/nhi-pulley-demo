# NHI pulley demo

[Open the demonstration](https://kyle-annora.github.io/nhi-pulley-demo/) · [Direct Patrick entry](https://kyle-annora.github.io/nhi-pulley-demo/patrick.html) · [Offline backup](https://kyle-annora.github.io/nhi-pulley-demo/presentation-kit/backup.html)

A focused presentation for Patrick: understand F-4412 in 3D, retain a useful mounting question in the inquiry, and follow the same fictional case through seller review, quote v1, a change request, quote v2 and an acknowledged engineering-review plan.

The seven-minute route uses explicit save, review and issue actions. The three-minute route is a clearly labeled, read-only prepared replay. The main story starts at 200 units, requests 250 units, and shows v2 at a $2,260 priced subtotal. Five-week delivery remains unconfirmed, freight and tax remain unpriced, and engineering findings remain open.

The optional Explorer / Studio branch uses a **separate crank sample**. It demonstrates authored motion and product-content draft → customer preview → reviewed local publication. It returns to the F-4412 case; its capabilities are not represented as validated F-4412 operation or a live NHI integration.

## Run locally

Use Node 22.12 or later.

```sh
npm ci
npm --prefix shared-explorer ci
npm run verify
python3 -m http.server 4173 --bind 127.0.0.1 --directory _site
```

Open `http://127.0.0.1:4173/`. `_site/` mirrors the hosted package. Its root opens Patrick's presentation; legacy query / hash entrances continue to `workspace.html`. The shared Explorer and capability snapshot must remain beside the HTML entries.

## Source and maintenance

- `src/patrick-entry.jsx` and `src/patrick-flow.mjs`: presentation shell and reviewed state transitions.
- `src/features/patrick-capabilities.jsx`: separate capability preview and return.
- `src/components/`, `src/design/`: shared NHI controls and visual system.
- `shared-explorer/`: pinned F-4412 runtime, illustrative model, source and licenses.
- `capability-preview/`: portable, namespaced Annora platform snapshot with upstream provenance and licenses.
- `presentation-kit/`: six-scene static fallback, prepared example fixture and English scripts.
- `tests/fixtures/`: reviewed synthetic regression fixtures; these are not customer records.
- [Design contract](DESIGN.md), [deployment notes](docs/deployment.md), [English talk track](docs/presentation/patrick-talk-track.md).

`npm run build:site` builds the host and produces the allowlisted static package. `npm run verify` checks the host, verifies the pinned F-4412 package, then builds the site. GitHub Pages publishes the `gh-pages` branch. The `main` branch contains the editable source and pinned assets.

## Example and storage boundaries

All customer identities, demand, prices, requests and commercial terms are fictional. The F-4412 model is illustrative, not manufacturer CAD. This demo does not send an RFQ to NHI, approve engineering fit, accept a quote or create an order. Studio publishing is a browser-local example release.

Browser records stay with their origin. The hosted page starts its own local records; it does not upload or migrate records from a localhost browser. Patrick presentation records, prior runs and the separate capability snapshot use distinct storage namespaces.

Historical research, chat context, local screenshots and browser-record exports are not part of this repository or Pages package. Upstream software and model notices remain in [third-party notices](THIRD-PARTY-NOTICES.md), `shared-explorer/dist/LICENSES.txt` and `capability-preview/LICENSES.txt`. NHI branding is used in this labeled demonstration; it is not an official NHI website or offer.
