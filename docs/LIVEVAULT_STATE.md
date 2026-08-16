# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative.

## v130 New Fix 1 state

NF1 is implemented on `fix/state-feedback-corrections-v130` in PR #136 as v130. It extends the global processing indicator so perceptible user-requested work is owned by actual async work rather than a fixed post-click timer. Fetch-backed work remains tracked, and local IndexedDB transactions now keep the interaction pending through their terminal `complete` or `abort` lifecycle. Duplicate suppression uses stable control data so distinct repeated-label actions remain independent. The indicator remains delayed to avoid flicker on fast operations and the DOM-settlement fallback handles purely local render work without a fixed 180 ms action duration.

NF1 also applies the established neutral-grey outline consistently to image-backed and initials/fallback avatars, and aligns concert listening-summary icon/text geometry with the preparation rows. Stable IDs, user-owned fields, unknown future fields, provider ownership, immutable listening observations, Worker/R2 behavior and production data remain unchanged.

`APP_VERSION`, `CACHE_NAME_LITERAL` and deterministic build facts are synchronized at v130. Unit/safety, desktop Chromium and mobile Chromium QA pass on head `694007679a293938eeea79e6290e23e6c8fbfd38`, including a synthetic >140 ms local IndexedDB lifecycle regression. No production provider call, production data write, production workflow, production deployment, merge or auto-merge is authorized by PR #136.
