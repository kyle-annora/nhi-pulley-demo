# Third-party notices

- NHI logo and catalog facts: public NHI sources, used in this labeled demonstration. No NHI CAD, approved price or issued quote is represented.
- React and React DOM 19.3.1: MIT.
- Base UI 1.9.0: MIT, unstyled button/input/toggle/radio behavior.
- shadcn/ui: MIT. Button, Input and Textarea installed using pinned shadcn CLI 4.23.0 and `base-nova`; official source retained at `docs/components/shadcn-upstream.json`. Local adaptation replaces the upstream `cn` package import with `src/lib/utils.ts`; NHI wrappers and scoped CSS own appearance and state refinements. Source: https://ui.shadcn.com/docs/components/base/button .
- class-variance-authority 0.7.1: Apache-2.0. clsx 2.1.1 and tailwind-merge 3.3.1: MIT.
- Tailwind CSS/CLI 4.3.3 and esbuild 0.25.10: MIT, build tooling. Global Tailwind preflight is intentionally omitted to isolate this migration.
- Three.js 0.180.0: MIT; existing illustrative Explorer retained.
- jsPDF 4.2.1: MIT. Updated from 3.0.3 after the dependency audit identified a critical advisory in the installed version. Existing quote generator API and downloaded output are regression checked.

Installed package licenses and the shadcn source license are copied to `assets/licenses/` where available. The bundle retains legal comments. `package-lock.json` records exact transitive dependencies. No runtime CDN, account or external submission has been added.
