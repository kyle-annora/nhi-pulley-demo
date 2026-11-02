# Project configuration

`project.config.json` is the only project-level configuration source. Generate
runtime files with `npm run prepare:project`; `dev`, `test` and `build` do this
automatically. Restart development after changing the configuration or manifest.

```json
{
  "schemaVersion": 1,
  "id": "my-explorer",
  "title": "My assembly Explorer",
  "description": "Explore the assembly and see how its components work together.",
  "brand": {
    "name": "MY COMPANY",
    "product": "ASSEMBLY EXPLORER",
    "homeUrl": "./",
    "accent": "#ff6840"
  },
  "defaultModel": "kinetic-01",
  "features": {
    "explode": true,
    "operation": true,
    "tour": true,
    "themes": true,
    "quality": true,
    "renderStyles": ["engineering", "linework", "flat"]
  },
  "models": [
    {"manifest": "content/models/kinetic-01/manifest.json"}
  ]
}
```

Use a unique lowercase `id` for browser preference isolation. `brand.accent` is a
six-digit hex color; Ember is the default. Optional `brand.logo` points to an
image file inside the repository, or an HTTP(S) image URL. Local images are built
with the site. Brand strings are text, not executable HTML. `homeUrl` accepts a
safe relative path or an HTTP(S) destination, without embedded credentials.

A model is identified by its manifest ID, not its directory name. The
`defaultModel` must be listed exactly once in `models`. Use `?model=<id>` to open
another listed model directly. Unlisted model IDs fall back to the configured
default. Unknown configuration keys fail validation to catch misspellings.

## Feature policy

| Setting | Meaning |
| --- | --- |
| `explode` | Allow separation and restoration controls |
| `operation` | Allow authored operating clips, if present |
| `tour` | Allow an authored tour, if its required functions are enabled |
| `themes` | Let the visitor change the configured default accent |
| `quality` | Expose quality choices; adaptive safeguards still apply |
| `renderStyles` | Nonempty subset of `engineering`, `linework`, `flat` |

This policy is enforced by the UI and JSON controller. Hiding a button alone is
not considered feature isolation. Host settings can narrow the allowed set, not
re-enable functions disabled by the project. A tour is omitted if it requires a
disabled operation, explosion or rendering style; validation reports this.

Engineering is the default when available, otherwise the first enabled style is
used. `linework` and `flat` require both derived crease and silhouette packages.
A model without an operating clip cannot be given operation by toggling a flag.
The same applies to an absent tour.

The configuration does not contain analytics credentials, customer information,
private API keys or server behavior. All build-time project values are public.
