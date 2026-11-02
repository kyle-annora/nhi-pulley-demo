---
name: explorer-project
description: Configure, import content into, validate, integrate or deploy a project made from the Annora Explorer template. Use for new branded Explorer projects, model packages, capability selection and static hosting; not for unrelated websites or backend work.
---

# Create an Explorer project

1. Read `README.md` and identify whether the request changes project configuration,
   model content, host integration or shared runtime behavior.
2. For a branded project, edit `project.config.json`; use
   `docs/configuration.md`. Preserve the existing floating UI and approved visual
   treatments unless redesign is explicitly requested.
3. For a new model, read `docs/models.md` and inspect the input/definition first.
   Use `npm run import:model -- --source <source.glb> --definition <definition.json>
   --out content/models/<folder>`. Preserve rights, source identity and authored
   animation. Do not invent motion, mechanical validity or public provenance.
4. Register the prepared manifest in the project configuration. Adding a model
   must not require model-specific branches in `src/explorer/`.
5. For another app, read `docs/integration.md` and `docs/api.md`. Use the JSON
   interface and capability discovery, not DOM selectors or renderer internals.
6. Run `npm run verify`. Review the built site on desktop/mobile and inspect the
   actual changed capabilities. Use `docs/evaluation.md`; distinguish measured
   evidence from untested assumptions.
7. If publication is authorized, follow `docs/deployment.md`, inspect the
   publishable artifact, deploy and verify the live repository subpath. The skill
   itself does not authorize publication or account changes.
8. Report source/preview links, exact checks and material limitations. Maintain
   English project files and a concise release review.

For unsupported input, provide the specific conversion/preparation requirement.
Do not silently discard parts, fabricate a tour or alter the renderer to make one
asset appear to pass. Use `examples/bench-vise/` as a reproducible reference, not a
mandatory geometry style. Generated files and derived binaries are outputs;
update configuration and source definitions instead.
