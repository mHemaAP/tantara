# Research Desk round 2 report

## Changes and evidence

- **Shared shell overlap:** removed feature rules that affected global page positioning, corrected mobile Research ordering, and retained feature-only layout selectors. Playwright checks the fixed header and sidebar at the viewport origin after scrolling/navigation at 1440 and 390 widths. Captures: `frontend/docs/screenshots/research-desktop-empty.png`, `research-mobile-empty.png`.
- **Private endpoint leakage:** unavailable-model copy now says the model is unreachable and offers retry/evidence-only mode. The E2E assertion rejects URLs, loopback addresses, and port-like numbers in the callout. Captures: `research-desktop-model-unavailable.png`, `research-mobile-model-unavailable.png`.
- **Citation destination:** sources link through `documentPageUrl` and include document, page, and chunk. The test clicks the highest-page source and verifies destination URL and title. It then checks the viewer page control and page element. **The integrated Documents viewer fails those last assertions:** the title loads, but there is no `Page number` input and no visible cited-page confirmation. The Research lane cannot edit the Documents feature. The exact unmet contract is that `/documents/{id}?page=N&chunk=...` must select/scroll to page N and highlight the chunk. No end-to-end page arrival is claimed.
- **Claim/evidence linkage and insufficiency:** answer sentences show returned `citation_ref` links; raw retrieval ranks are rounded to two decimals. Insufficiency is taken from an actual reachable-model answer and keeps sources visible without generating a conclusion. Captures: `research-desktop-answer-citations.png`, `research-desktop-insufficient-evidence.png`, `research-mobile-answer-citations.png`, `research-mobile-insufficient-evidence.png`.
- **Mobile task order:** composer is ordered before history and sources on mobile; collection label can wrap. The layout test checks composer position within 844px and the full collection label width. Mobile state captures are listed above.
- **Totals and provenance:** distinct document IDs determine source counts; before a response the value is `—`. Dates use `DD Mon YYYY`; relevance is two decimals. Test-generated sessions and saved rows are deleted after each test. New research now creates a real session before asking, enabling history restoration after reload. Collection metadata is genuinely unavailable: `GET /api/v1/meta/collections` returns HTTP 404 `Metadata not found`; the selector displays that state. The case/jurisdiction selectors load from live endpoints.
- **Control interactions:** E2E exercises new research, case/jurisdiction scope selection, refresh, initial suggested question, Ask, history click, saved answer, Browse library, and retry after a forced model failure. The retry test restores the prior configured endpoint and observes a real generated answer. Relevant captures include `research-new-state.png`, `research-scope-selected.png`, `research-history-refreshed.png`, `research-suggested-question.png`, `research-history-entry.png`, `research-saved-search.png`, `research-retry-recovered.png`.

## Model provenance and backend gaps

The configured endpoint for the successful generation run was `http://192.168.0.101:8080/v1` with model `MiniCPM5-2B`, as provided for this round. A live ask returned a grounded answer (314-token probe from the round setup; the L5b tests also got generated answers, including the genuine governing-law insufficiency response). The unavailable-state test temporarily patched `/settings/ai` to `http://127.0.0.1:1/v1`, observed `model_unavailable` with no answer text, then restored the previous setting and successfully retried. Backend `/ai/status` reports `status:"ok"` and a model name even when the model cannot be reached; this is not proof of model reachability. The UI does not display or use those fields as proof and adds no reachability probe.

## Commands and results

- Isolated backend: `127.0.0.1:8114`, v1.1.0; temporary `TANTARA_DATA_DIR` plus matching `DATABASE_URL`; migrations and demo seed completed. Frontend used `127.0.0.1:3013`.
- `pnpm format`: passed.
- `pnpm lint`: passed, no ESLint warnings/errors.
- `pnpm typecheck`: passed.
- `pnpm build`: passed; `/research` built at 7.55 kB.
- `TANTARA_WEB_URL=http://127.0.0.1:3013 NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8114 pnpm test:e2e`: 10 passed, 6 failed (16 total). Research success/no-evidence/insufficiency/model-unavailable and shell/mobile tests passed. One Research control run exposed persistence and capture-flow issues that were corrected afterward; the final citation test still correctly fails at the Documents viewer page-input assertion described above. Four existing `smoke.spec.ts` checks also fail against this private v1.1.0 backend: routes expect unavailable `/cases/case-1`, profile/settings controls differ, and dashboard test hardcodes the prohibited integration port 8010. Those tests were not weakened or changed.

## Screenshots

Required state captures are under `frontend/docs/screenshots/`:

- Desktop: `research-desktop-answer-citations.png`, `research-desktop-insufficient-evidence.png`, `research-desktop-model-unavailable.png`, `research-desktop-empty.png`.
- Mobile: `research-mobile-answer-citations.png`, `research-mobile-insufficient-evidence.png`, `research-mobile-model-unavailable.png`, `research-mobile-empty.png`.
- Additional control captures: `research-new-state.png`, `research-scope-selected.png`, `research-history-refreshed.png`, `research-suggested-question.png`, `research-history-entry.png`, `research-saved-search.png`, `research-retry-recovered.png`.

All captures were taken after waiting for network idle and checking that no loading/skeleton markers remained; `devIndicators: false` is set.

## Commits

One file per commit; no push or merge.

- `4a9f846` Research behavior and session persistence.
- `48e5901` Research feature CSS and mobile order.
- `00a3aee` Research E2E coverage and capture helper.
- Screenshot commits: `392c907`, `5f5a9e1`, `790488b`, `6d1ce02`, `404c043`, `e9e5bab`, `6cdf32d`, `2e23321`, `0e47f8e`, `1377500`, `614c87c`, `b4c5313`, `b0b81ef`, `0477fd1`, `1ed8577`, `5326961`, `07bc5e1`, `3d1d866`.
- This report: see its commit in the final round summary.
