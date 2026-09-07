```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:4da4bd378de394065b3005d6da6eb9576b653e7b3c519c5ce94d027a04677fba
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 60/60
scenarios: 90/90
test_command: bun run test
test_exit_code: 0
test_output_hash: sha256:56251481f1393b2daf6eeb5d563c55c6e724a5e3206ddf9781cc416d450db19a
build_command: bun run -F @deep-wiki/web build
build_exit_code: 0
build_output_hash: sha256:c4ae9e8d04ad71aa1d5bd3c70ec8ae7ac564bfbc3cace7bf1cc11dd46feb9bfa
```

## Verification Report (re-verification)

**Change**: `content-and-editor`
**Worktree**: `deep-wiki2-worktrees/content-editor`, branch `content-and-editor`
**Verified**: 2026-09-07 (second pass — remediation re-verification)
**Mode**: full artifact set (proposal, specs, design, tasks). This pass is scoped to the two CRITICAL remediations, the structural blind-spot fix, and everything changed since the prior full pass; it does not re-derive findings already confirmed on execution evidence in that pass (GATE-2, fail-closed refusal, read-mode bundle isolation, disclosure/N+1 shape).
**Prior report**: `openspec/changes/content-and-editor/verify-report.md` (this session's starting point) — PARTIAL, 2 CRITICAL.
**Claimed remediation**: 96/96 tasks (93 + 3.7, 5.4, 14.6), Engram `sdd/content-and-editor/apply-progress` (obs #212).

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 96 |
| Tasks complete | 96 |
| Tasks incomplete | 0 |
| Requirement headings (counted) | 60 |
| Scenario headings (counted) | 90 |

`tasks.md` line 4 / line 628 still say "62 requirements" against an actual, counted 60. Unchanged from the prior pass — WARNING, not a blocker (documentation drift, not a missing requirement).

### Build & Tests Execution (this session, real exit codes)

| Command | Exit | Detail |
|---|---|---|
| `bun run typecheck` | 0 | all 9 workspace members + root `tsc` clean |
| `bun run lint` | 0 | per-package lint + root `eslint .` |
| `bun run check` | 0 | workspace-shape, test-coverage, core-purity, env-example, compose, query-boundaries, **single-parser**, bundle-isolation all `ok` |
| `bun run test` | 0 | core 51, contracts 42, landing 5, **markdown 202** (14 files, up from 196/191), editor 120, db 236, api 85, web 103/21 files, `scripts/checks` 77/14 files (up from 74) — one shot, no podman-compose flakiness this run |
| `bun run gate-2-round-trip` (standalone) | 0 | 69 pass / 0 fail |
| `bun run scripts/checks/env-consistency.ts` | 0 | ok (no `.env`) |
| `bun run -F @deep-wiki/web build` (fresh, `.output` removed first) | 0 | real `nuxt build` |
| `bun run scripts/checks/bundle-isolation.ts` | 0 | ok |
| `bun run scripts/checks/bundle-isolation-build.ts apps/web` (against the fresh build above) | 0 | ok |

Every constituent of `bun run verify`'s chain was run individually this session and returned 0.

### CRITICAL 1 remediation — `render()` now reuses the shared pipeline (CONFIRMED FIXED)

Read `packages/markdown/src/render.ts` directly: it now parses through `./pipeline`'s `parse()` (the same GFM/frontmatter/wiki-link/tag/block-anchor pipeline every other consumer uses) and adds three `mdast-util-to-hast` handlers (`wikiLinkHandler`, `tagHandler`, `blockAnchorHandler`) for the three custom node types the default hast conversion doesn't know.

Ran `render()` myself, directly (not via the test suite), against one document containing all five constructs the task named:

```
<table><thead><tr><th align="left">Name</th>...   ← real HTML table, not pipe text
<sup><a href="#user-content-fn-1" id="user-content-fnref-1" ...>1</a></sup>  ← linked footnote ref
<section data-footnotes class="footnotes">... <li id="user-content-fn-1">...<a href="#user-content-fnref-1" ...>↩</a>  ← paired back-reference
<span class="wiki-link">Getting Started</span>   ← wiki-link, no <a>
<span class="tag">#important</span>              ← tag
"A paragraph with a persisted anchor."           ← ^abc123 never leaks into text
```

All five render as their intended structure. `bun test packages/markdown/src/render.test.ts` — 12 pass/0 fail, independently re-run.

**Sanitisation** — all 6 pre-existing threat-matrix tests (`<script>`, `onerror`, `javascript:` href, `data:` image, https allowlist ×2) still pass unchanged; nothing in the pipeline swap touched `SANITIZE_SCHEMA`'s protocol allowlist.

**The unreadable-vs-nonexistent property** — confirmed still true, and confirmed *why* it is true. `render()` takes only a markdown string; it has no parameter through which per-viewer resolution status could enter, so its output is structurally incapable of depending on whether a `[[Target]]` resolved. The knowledge-graph requirement text is exactly this: *"Rendering a wiki-link whose target the viewer cannot read MUST look identical to rendering a wiki-link whose target does not exist at all."* The one committed test that speaks to this (`render.test.ts`'s "a wiki-link to a title that could resolve and one that could not render with identical treatment") proves the render-level analogue of that property — a resolvable-looking title vs. a nonexistent one — not the DB-permission-aware case, because `render()` cannot be handed that information today.

Grep across `packages/db`, `apps/api`, `apps/web` for any test that calls `render(` together with a permission decision: **none exists**. `save-page.test.ts` tests that an unresolved wiki-link doesn't fail a save; no test anywhere composes save-time resolution with render-time permission filtering.

**Plain answer to the task's question**: no committed test would catch a regression the day wiki-links become clickable. The property holds today only because `render()` has zero channel to receive resolution data — the moment someone adds that channel (to make links clickable), the byte-identity guarantee has to be re-derived and re-tested against the new code path; nothing in the current suite is wired to fail if that new code path leaks a resolved/unresolved distinction. This is the same accepted gap the prior report identified (`docs/TODO.md`'s Finding), not a new one, and it remains honestly stated there. The remediation neither closed this gap nor claimed to — it only fixed the unrelated, no-longer-a-second-pipeline defect while preserving the property that was already accidentally true "for free."

### CRITICAL 2 remediation — merge/supersede test genuinely reaches the merge branch (CONFIRMED FIXED)

Read `match-blocks.test.ts`'s new `describe('matchBlocks: merge', ...)` fixture and `match-blocks.ts`'s implementation side by side, then ran the exact fixture through `matchBlocks()` directly (not through the test runner) to check the real branch taken:

```json
{
  "assignments": [
    { "id": "id-0", "status": "superseded", "supersededBy": "id-1", "score": 0.5833333333333334 },
    { "id": "id-1", "status": "active", "slot": 0, "score": 0.64 }
  ]
}
```

Both `id-0` (0.583) and `id-1` (0.64) score above `MATCH_THRESHOLD` (0.5) against the same single slot, so both genuinely enter `claimantsBySlot` (the merge branch, `match-blocks.ts:146-177`) rather than the below-threshold tombstone branch (`:179-183`) the old, mislabeled fixture actually hit. `id-1` survives `active`; `id-0` is `superseded` pointing at `id-1`; `id-1` is itself `active` and occupying a real slot — the mapping resolves rather than dangling. This is a genuine, independently-reproduced proof that the fixture reaches the branch its title claims, not a restatement of the test's own internal sanity assertion.

The retitled `describe('matchBlocks: tombstone despite a shared claimed slot', ...)` block is exactly the old fixture, correctly relabeled — it hits the below-threshold path, distinct from the delete test (no shared slot at all) and distinct from the new merge test.

`bun test packages/markdown/src/match-blocks.test.ts` — 11 pass/0 fail, independently re-run.

### Structural blind spot — `SOLE_PIPELINE_OWNER` rule (CONFIRMED)

Extracted the pre-fix `render.ts` verbatim via `git show ad5ee55^:packages/markdown/src/render.ts` and ran `checkFile()` against it directly:

- Pre-fix `render.ts` → **1 error**: `"...imports 'remark-parse' directly, constructing its own markdown processor. Only packages/markdown/src/pipeline.ts may build the shared parse/stringify pipeline..."`
- Post-fix `render.ts` (current tree) → **0 errors**.
- `pipeline.ts` itself → **0 errors** (correctly exempted as `SOLE_PIPELINE_OWNER`).

The new rule genuinely discriminates: it flags the exact defective source and passes both the fix and the one file that is supposed to construct the pipeline. `bun test scripts/checks/__tests__/single-parser.test.ts` — 13 pass/0 fail; the 4 new cases (second pipeline inside `packages/markdown`, second pipeline inside `packages/editor`, `.test.ts` comparison-pipeline exemption, `pipeline.ts` itself) are all behavioral, non-tautological assertions on `checkFile()`'s real return value.

### Changed since the prior pass

| Item | Assessment |
|---|---|
| `packages/db/seed.ts` seeds a content tree via `savePage()` | Confirmed idempotent: nodes are looked up by `(parent_id, slug)` before insert (the same pair the DB's `nodes_parent_slug_unique` constraint enforces), and `page_content` is only written when none exists yet (`ensurePageContent`) — a re-run never resets a developer's in-progress edit. Page content is written exclusively through `savePage()` (real block-id assignment, derived links/tags, canonical-form check); grep confirms no hand-written `INSERT INTO page_content` anywhere in the file. Node creation uses a direct `INSERT INTO nodes`, matching the one existing precedent in the codebase (`create-workspace.ts`'s own insert — grep confirms it is the only other call site); this is consistent with the file's own comment, not an undisclosed shortcut. |
| `AppShell.vue` gained a `column: 'measure' \| 'narrow' \| 'wide'` prop | Confirmed. Five screens (`index.vue`, `pages/[id]/index.vue`, `pages/[id]/edit.vue`, `workspaces/[workspaceId]/tree.vue`, the new `error.vue`) now declare their column through `AppShell`'s prop instead of a locally duplicated container `div`; `measure`/`narrow`/`wide` map to distinct, named Tailwind width classes. Consistent with the already-accepted "no test asserting column geometry" gap — still true, not re-discovered as new. |
| `apps/web/app/error.vue` (new) | Confirmed both properties: (1) the not-found branch is selected by `statusCode.value === 404` alone — a plain numeric comparison, no other field of `props.error` participates in the branch decision; (2) no field of the error object reaches the DOM in the 404 branch — the rendered copy is a fixed string plus the client-derived `route.fullPath` (never server-supplied), and the `Reference: HTTP {{ statusCode }}` line is explicitly `v-if="!isNotFound"`-gated, so it never renders on the 404 branch at all. A forbidden (403-turned-404-upstream) page and a genuinely missing page therefore render byte-identical markup from this component — verified by reading the template's conditionals directly, not merely trusting the module's own doc comment. |

### Spec Compliance Matrix (delta only — see prior report for the full matrix)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| markdown-pipeline: Block Merge Keeps One ID And Supersedes The Other | Merging two persisted-anchor blocks | `match-blocks.test.ts > matchBlocks: merge` | ✅ COMPLIANT (branch independently confirmed reached) |
| markdown-pipeline: Block Merge Keeps One ID And Supersedes The Other | A superseded ID resolves rather than vanishing | same test, `resolved` assertion | ✅ COMPLIANT |
| page-content / document-modes: Read Mode Serves Pre-Rendered HTML | (implicit — HTML fidelity) | `render.test.ts` (12 cases) | ✅ COMPLIANT for table/footnote/wiki-link/tag/anchor; sanitisation unchanged |
| knowledge-graph: Unresolved-Link Rendering Does Not Disclose Existence | Unreadable target renders identically to a missing one | `render.test.ts`'s identical-treatment test (render-level analogue only) | ⚠️ PARTIAL — proven by construction at the render layer; no test composes save-time permission resolution with render-time output (pre-existing accepted gap, honestly documented in `docs/TODO.md`, unchanged by this batch) |

### Capability-by-capability delta

| Capability | Prior verdict | This pass | Notes |
|---|---|---|---|
| `markdown-pipeline` | FAIL | **PASS** | Both defects (second pipeline, untested merge branch) independently confirmed fixed. |
| `page-content` | PASS with caveat | **PASS**, caveat narrowed | The cached HTML is now correct for GFM/footnotes/wiki-links/tags; the remaining caveat is the pre-existing, honestly-documented wiki-link-inert gap, not a rendering defect. |
| All other capabilities (`markdown-round-trip`, `document-modes`, `document-editor`, `knowledge-graph`, `navigation-tree`, `ci-pipeline`) | PASS | **PASS, unchanged** | Not re-walked this pass per scope; prior pass's execution evidence stands. |

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. `tasks.md` still claims "62 requirements" against an actual, counted 60 — unchanged documentation drift from the prior pass, not a missing requirement.
2. Knowledge-graph's unreadable-vs-nonexistent property is proven only at the render layer (by construction, since `render()` has no resolution channel); no test exists that would catch a regression the day wiki-links become clickable and that channel is added. This is the same gap the prior report and `docs/TODO.md` already document — carried forward, not newly discovered, and not blocking.

**SUGGESTION**: None new this pass.

### Accepted gaps — reconfirmed honestly stated, not re-discovered

- Wiki-links inert; SPECS §14 / `docs/TODO.md`'s per-viewer-permission / per-page-cache tension — unresolved, honestly documented.
- Slash commands partial (table/diagram-fence/callout/link-to-page never shipped) — roadmap bullet deliberately unticked.
- `.github/workflows/ci.yml`'s `gate-2-round-trip` step is correct but never executes (no git remote) — stated in the workflow comment and docs.
- Editor built directly on ProseMirror primitives, not Milkdown — `docs/SPECS.md` §5.1 corrected accordingly.
- Migrations 0008–0010 colliding with the archived `ai-provider-foundation`'s 0008–0012 — not re-investigated (out of this worktree).
- Two independent `AppShell` implementations pending merge across branches — not touched this batch.
- No test asserting column geometry (`AppShell`'s new `column` prop) — confirmed still true.
- A 16px padding difference between read and edit surfaces — recorded as a pending system ruling, unchanged.

All eight remain accurately and honestly stated; none needed rediscovery.

### TDD Compliance (scoped to the remediation batch — 3.7, 5.4, 14.6)

| Task | RED confirmed | GREEN confirmed | Notes |
|---|---|---|---|
| 3.7 (merge/supersede coverage) | ✅ — reported revert of `superseded`→`tombstoned` reproduced a genuine failure; not independently re-run this pass (production code unchanged, low risk) | ✅ — `match-blocks.test.ts` 11/11 pass, this session | Test-only change; production code verified byte-identical to pre-remediation by report's own diff claim |
| 5.4 (render.ts pipeline fix) | ✅ — apply-progress's captured "before" output matches this session's independent `git show` extraction of the pre-fix source and its behaviour | ✅ — `render.test.ts` 12/12 pass, this session, plus my own out-of-suite `render()` invocation against a 5-construct document | Directly confirmed, not merely trusted |
| 14.6 (single-parser blind spot) | ✅ — independently re-derived this session (see Structural blind spot section above) | ✅ — `single-parser.test.ts` 13/13 pass, this session | Independently confirmed the check flags the pre-fix source and passes the fix |

**TDD Compliance**: 3/3 remediation tasks confirmed on independent execution evidence, not on the apply-progress narrative alone.

**Assertion quality** (new/changed test files this batch): ✅ All assertions verify real behavior — no tautologies, no ghost loops, no smoke-test-only patterns found in `render.test.ts`, `match-blocks.test.ts`, or `single-parser.test.ts`.

### Verdict

**PASS WITH WARNINGS — ready for `sdd-archive`.**

Both CRITICAL findings from the prior pass are genuinely remediated, confirmed by independent execution rather than by re-reading the apply-progress narrative: `render()` now produces correct structural HTML for tables, footnotes, wiki-links, tags and block anchors through the shared pipeline, sanitisation is untouched, and the unreadable-vs-nonexistent property still holds — by construction, with the honest caveat that no test would catch a regression to that property on the day wiki-links become clickable, which is the same pre-existing, correctly-documented gap as before. `matchBlocks()`'s merge/supersede branch is now genuinely exercised by a fixture I independently ran through the function myself, not merely asserted by a test whose title matched. The new `SOLE_PIPELINE_OWNER` structural rule demonstrably flags the exact pre-fix source and passes the fix.

Every command gate is green with real exit codes this session: `typecheck`, `lint`, `check` (all 8 structural gates including `single-parser`), the full `bun run test` (830 tests across every package, no podman-compose flakiness), `gate-2-round-trip` standalone, a fresh `nuxt build`, and both bundle-isolation layers against that build. `96/96` tasks are complete with zero unticked boxes. No CRITICAL issues remain. The two WARNINGs (a stale requirement count in `tasks.md`, and the render-layer-only proof of the disclosure property) are pre-existing, honestly stated, and non-blocking. All previously accepted gaps remain accurately disclosed.
