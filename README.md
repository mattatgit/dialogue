# Dialogue prototype v1

Static interaction prototype based on the Figma section `Dialogue App views` in `Idealogue WIP`.

## Start
Open `index.html` in a browser. No build step or server is required.

## Included flow
- Sign in → Projects
- Projects → Landline project
- New Project modal
- Profile modal
- Landline V19 owner view
- Share button (copies/opens the public Share view)
- Restart button and `R` keyboard shortcut
- Settings skeleton
- Public Share view (HTML/CSS only)

## Notes
- This is a UI/flow prototype, not the production architecture.
- Inter Tight is loaded from Google Fonts and used as the default UI typeface.
- The embedded Landline example is intentionally recreated locally as representative CSS artwork. In the real app this area becomes the isolated prototype iframe.
- The public Share shell contains no JavaScript. The sample prototype shown inside it is CSS-only. When a future prototype requires JavaScript, Dialogue can gate it with the planned viewer warning/consent state.
- The missing Share dialogue, prototype/project management UI and full Settings/LLM integration should follow the future Figma designs rather than being invented here.


Asset update: Figma SVG exports are now stored locally in assets/ and used for the wordmark, navigation icons, project badges, heart, upload control, New badge, profile arrow, and prototype tile menus.


## v2 interaction notes
- Sign-in is intentionally a mock: focusing/clicking either field auto-fills demo values, and Sign in always opens Projects.
- Parent breadcrumb items are real links on Project and Prototype views.
- Button labels use flex centering and a normalized line-height to prevent vertical misalignment.


## Breadcrumb / tile polish

- Breadcrumb separator uses the exact Figma character: U+2192 RIGHTWARDS ARROW (`→`) in Inter Tight SemiBold.
- Breadcrumb links remain un-underlined; hover/focus/active states use colour only.
- Prototype tiles use the same hover shadow as project tiles.

### v3 breadcrumb fidelity
- Breadcrumb typography now uses true Inter Tight SemiBold (`font-weight: 600`) rather than the previous 650 approximation.
- `font-synthesis: none` prevents the browser from manufacturing heavier faces.
- Figma confirms the separator source character is U+2192. Because Google Fonts CSS subsets may omit that glyph and trigger a fallback font, the breadcrumb separator is rendered as a tiny inline vector so its shape stays consistent with the design.


V4 updates:
- Primary/button hover scale: 105%.
- Project and prototype tile hover scale: 102% (with existing shadow).
- Landline prototype thumbnail and full-size viewer now use supplied PNG exports from Figma.


## v5 tile clipping fix
- Prototype tile radius now belongs to a dedicated inner clipped surface rather than the transformed link itself.
- Removed the nested bottom-corner radius from the white info panel; the outer clip now owns all four corners.
- Added Safari/WebKit-friendly clipping and compositing guards to prevent 1px corner seams during transforms.
- Hover shadow now uses a negative spread so it reads as a soft lift rather than a grey edge/stroke.


## v6 change
Prototype tile metadata is explicitly stacked: prototype title on the first line and edited date/time on the second line, while the meatball menu remains independently positioned on the right.
