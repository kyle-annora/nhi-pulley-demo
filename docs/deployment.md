# GitHub Pages deployment

Repository: `kyle-annora/nhi-pulley-demo`.

The editable source and pinned models are on `main`. Pages serves the built static package from the root of `gh-pages`. This uses GitHub's branch-based Pages build; no credential or token belongs in the repository.

## Prepare a release

```sh
npm ci
npm --prefix shared-explorer ci
npm run verify
```

Commit the reviewed source, then run `npm run build:site` so `_site/build-info.json` records that source commit. Publish only `_site/` to the `gh-pages` branch. Preserve branch history when updating it; a deployment does not require a force push.

The packaging allowlist includes the two built applications, relative model / runtime folders, attribution, static backup and English script. It excludes dependencies, source code, tests, historical research and local browser exports from the Pages site. The public source branch contains reviewed synthetic test fixtures.

The root dispatcher sends a plain project URL to `patrick.html`. Existing workspace query / hash links are forwarded to `workspace.html` with their context intact. Direct links to both entries also work under the repository subpath.

## Verify the deployed commit

- Root → Patrick opening; the three-act route and prepared replay remain usable.
- F-4412 model / three checks load under `/nhi-pulley-demo/` and preserve origin-checked controller behavior.
- Separate Explorer tour plays, Studio preview opens, and Return to F-4412 restores the current scene.
- Existing example workspace, English script, static backup and ZIP download resolve.
- Check desktop and a responsive phone viewport; report browser testing rather than physical-device testing.
- Read `build-info.json` to match the published package to a source commit.

The browser owns example records under the current origin. Localhost data is not uploaded or migrated. Model bytes remain downloadable by visitors; retain source attribution and all licenses. Studio's in-app local publication does not redeploy GitHub Pages.
