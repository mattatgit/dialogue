# Shared sidebar correction — 12 November 2026

Base: deployed application `62e4b992290cecd8ea04310871fac1177eba1883`. Application changes belong to Build; Setup & install owns rollout. Matt reported that hosted navigation still jumps between Settings and other pages, while the local build is already fixed.

## Cause and focused correction

The deployed Settings stylesheet overrides the shared sidebar:120px versus104px brand area, different navigation padding/row sizes/icon masks, and a224px account button inside a216px sidebar. Its compact account row is also shorter. The newer local sidebar correction had not been part of the pinned deployed snapshot.

This release carries only that correction from the local build. Settings uses the shared sidebar/logo/navigation/icon geometry; account rows share dimensions, avatar/name/role/chevron placement and responsive rules. Settings section links remain page-specific. Account chrome consistently renders the member role. Existing repository SVGs are reused; no new/redrawn assets.

Source scope: `css/settings.css`, `css/review-shared.css`, sidebar markup in Settings/Projects/Project/Build/Design systems/legacy Import, and the role text in `js/account.js`. The broader uncommitted local import-modal/gallery/backend work is deliberately outside this release and remains untouched in the original application checkout. No server, dependencies, worker/preview policy, account schema, credentials, project data or migration change.

## Validation and Setup handoff

The new real-Chrome regression navigates Projects → Settings → Design systems → Settings → Projects at1440px and390px, comparing logo, links, glyphs, labels and account/avatar/chevron geometry. It also scrolls Settings to verify fixed sidebar positioning and checks current-page navigation labels. It deterministically fails against the deployed CSS at the first Settings navigation and passes with the shared correction. The existing full Settings interaction/passkey/model test remains.

Local validation passed: all197 tests, zero failed/cancelled/skipped (18.24s); Nix package builds. Focused sidebar/Settings browser checks passed both tests (6.06s). Original-CSS reproduction failed in0.81s at the first Settings navigation, as intended. Logs are retained in `/private/tmp/dialogue-sidebar-{baseline-reproduction,browser,suite,package}.log`.

Run the full **197-test** suite for the exact corrected source, zero failed/cancelled/skipped, including the new browser regression. Nix packaging is required. Setup must verify the source/dependency manifest and confirm backend/worker/preview/acceptance scripts are byte-identical to accepted62e4b99 before relying on its native/capacity/recovery evidence; follow the normal deployment checks for the changed frontend. Existing real passkey proof, membership/provider boundaries, resource limits and Disconnect-aware forward-fix/recovery safeguards remain. No member provider reconnection or project transfer is requested.

Use the existing guarded rollout with a consistent fresh production backup/restore receipt, preserving current users, project data and private environment. After activation, verify exact release/CWD, public health/home, private API denial, Settings sign-in redirect and exact served hashes of changed shared/Settings CSS, account JS and page markup. Confirm authenticated navigation stays aligned in the hosted view. Report the actual deployed source and link. Deployment authorization continues from Matt's request to deploy Settings and this correction to its hosted behavior.
