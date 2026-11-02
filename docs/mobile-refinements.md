# Focused mobile and handoff refinement lock

Approved scope: preserve the F-4412 case, saved records, example labels and existing NHI visual language. Improve phone model positioning, separate business follow-up from the optional platform appendix, and remove nested phone Studio / buyer-preview scrolling.

## References and bounded roles

- Existing NHI silver / white, graphite stage and lime action system is the dominant visual target. No new font, library or whole-site structure.
- User-observed live walkthrough: phone model opens below the viewport; scrolling over the embedded model can take control of the tour; the completed case's green capability button competes with the customer's real follow-up.
- [Hashnode device preview](https://refero.design/pages/dd0b1627-57c9-4c14-a700-6e12a0a19a4d): borrow a distinct preview surface with an explicit exit / editor return, not its phone ornament, typography or colors.
- [Squarespace saved / unsaved exit](https://refero.design/pages/2677be41-9033-45f2-a6c7-53ac092a13a4): preserve explicit draft/save boundaries when moving between editing and preview. Do not invent autosave or silently discard edits.
- Refero craft guidance: semantic focus targets, scroll margins, no automatic phone keyboard activation, and one contained full-screen surface with controlled scrolling.

| Decision | Evidence / role | Build target |
| --- | --- | --- |
| Model / question positioning | Direct phone walkthrough and anchor craft | Opening 3D focuses its labeled stage; closing returns to the current question. Preserve document scroll ownership and reduced-motion preference. |
| Business ending | User's task and saved review plan | Lead with the customer's application information, retain quote / question evidence, end the primary workflow. The optional capability preview is a separate, quiet appendix. |
| Phone Studio | Device-preview reference and observed nested frames | One viewport, one visible application. Studio preview opens the buyer experience directly with Back to Studio and Return to F-4412. |
| Mobile capability proof | User's request | Demonstrate question-first inspection, on-demand 3D, readable v2 and direct buyer preview on an actual responsive phone viewport. No simulated device marketing frame or unsupported product claim. |
| Records | Existing contract | Presentation navigation and viewport changes do not create, resolve or rewrite RFQs, quotes, questions or acknowledgements. |

## Implemented verification

The final component uses semantic model / question focus targets, a customer-first completion layout and a separate optional appendix. The phone capability shell fills the viewport and restores normal host scrolling on return. Direct Studio customer preview retains the hidden/inert Studio instance so Back to Studio and Review release use its real saved draft and reviewed state.

Local browser checks on the actual repository subpath covered 390 × 844 and 320 × 720 phone viewports, on-demand F-4412 positioning and return, authored motion to completion, saved Studio editing, direct customer preview, both return controls, release review and a guarded local example publication. An unsaved introduction survived phone → desktop → phone resizing; an open direct preview also returned to its existing editor after desktop resizing. One visible app frame and a document height equal to the phone viewport were observed. Returning to F-4412 restored the same case and normal document scrolling.

The F-4412 business-state UI export after all local capability actions deep-equals the deterministic prepared case. Application tests: **127 passed**; pinned F-4412 checks: **30 passed**, validation/build passed. The new route/bridge cases check source/origin rejection and bounded preview routes. The static offline fixture is unchanged, with an updated current completion capture and a 45–60 second English mobile demonstration sequence.

These are responsive browser checks, not physical-device or measured performance claims. Online release identity is available in the deployed `build-info.json`; implementation and verification do not establish final user visual acceptance.
