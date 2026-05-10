# Handoff — daily-ai-updates

Living progress doc. Update on every session boundary so the next pickup has zero ambiguity about where to start.

**Last updated:** 2026-05-10 (Day 3 #12 ignore-weighting wired + ignoreStory action; 73 tests passing)
**Next milestone:** Live smoke of `/api/cron/score` — **STILL GATED on user pasting real profile content into `/profile`**

---

## TL;DR for the next session

Day 2 done. Day 3 done in code (a + b + tests, 37 pass). `/` now server-renders the user's real scored feed — currently shows the empty "Your feed is being personalized" state because `story_scores` is empty. The moment scoring runs against a non-empty profile, the feed lights up automatically.

**What ingestion looks like:** 188 stories across HN Algolia + GitHub Trending. Anthropic blog still 404s — spawn task queued.

**What's now wired:**
- `ANTHROPIC_API_KEY` is in `.env.local`.
- V1 single user row seeded: `id=f8a25c61-f381-4e58-ad4a-e7690474f0a1`, `email=tfenley23@gmail.com`. Constant in `src/lib/v1-user.ts` as `V1_USER_ID`.
- `/profile` — async page reading `users.profile_md`, client `<ProfileEditor>` + server action + Sonner toast. 10KB cap.
- `/repos` — async page reading `user_repos`, client `<RepoForm>` + `addRepo` server action. Parses bare `owner/repo`, full URLs, www. variants. Fetches README via `/repos/{o}/{r}/readme` and manifests (package.json / requirements.txt / pyproject.toml) via `/contents/{path}` in parallel. Stores readme + `manifest_json`. 5-repo cap, dup check, friendly errors via `RepoFetchError`.
- `<Toaster />` mounted in root layout.
- `users` and `user_repos` tables in `database.types.ts`.
- 30 tests pass (added 14 for scoring: prompt builders, mocked `scoreStory` happy path, cache_control assertion, refusal/validation/range/integer/empty-tag rejection paths).
- `src/lib/scoring.ts` — Sonnet 4.6 scoring module:
  - `buildSystemPrompt(ctx)` — pure function; profile + repos + scoring rubric. Stable across the inner per-story loop (cache prefix).
  - `buildStoryMessage(story)` — pure function; per-story user message.
  - `scoreStory(deps, ctx, story)` — calls Anthropic with `cache_control: { type: "ephemeral" }` on the system block, structured output via `output_config.format` (json_schema), JSON parses + post-validates score range 0-100 / non-empty `why_i_care` / lowercased trimmed tags.
  - Typed errors: `ScoringRefusalError`, `ScoringValidationError`. Caller catches refusals (don't retry) vs validation (retry once) vs SDK errors (push to `scoring_retry_queue`).
  - `getScoringDeps()` lazy-instantiates the SDK client; tests inject a stub via `ScoringDeps.createMessage`.
- `@anthropic-ai/sdk` 0.95.1 installed.

**Out of scope intentionally on /repos (carry-overs):**
- **GitHub PAT support** — needs the `ENCRYPTION_KEY` env var (used by `set_encryption_key()` / `encrypt_pat()` SQL functions in the migration). **STOP-condition: user must decide where ENCRYPTION_KEY lives** (generate fresh, persist where? `.env.local` is fine for v1, but the Vercel deploy needs it injected too). This is Day 7 deploy-coupled work.

**Repo carry-overs CLOSED in this tick:**
- `removeRepo(id)` server action — UUID-validated, scoped via `WHERE id = ? AND user_id = ?` so a tampered formData can't affect another user's row. `revalidatePath("/repos")` after delete.
- `refreshRepo(id)` server action — loads existing row, re-runs `fetchPublicRepo`, updates `readme + manifest_json + fetched_at`. Same user-scoping.
- `<RepoRowActions>` client component — Refresh + Remove buttons per row. Each is its own form so `useFormStatus`/`useActionState` don't cross-pollute. Remove uses native `window.confirm()` (smallest safe destructive-action gate; nicer AlertDialog can ship later — cost of mistaken remove is low).
- `src/app/repos/actions.test.ts` — 10 tests covering: invalid-uuid rejection, success path payloads, `RepoFetchError` surfacing, supabase error propagation, missing-row → "not found" (locks down the cross-user safety invariant).
- `vitest.config.ts` (new) — registers the `@/` path alias so tests can `import` and `vi.mock` aliased modules. Earlier source-file workarounds (relative imports in `scoring.ts`, `github.ts`, `supabase/server.ts`, `supabase/auth.ts`) can be unwound at leisure.

**Newly added in this tick (Day 5 Try LLM module):**
- `src/lib/try-generation.ts` — Sonnet 4.6 Try-artifact generator. Mirrors `scoring.ts` shape exactly: `buildSystemPrompt(ctx)` (cached prefix, profile + repos + format/run rules), `buildStoryMessage(story)` (per-call user message), `generateTry(deps, ctx, story) → TryArtifact`. Structured output via `output_config.format` json_schema with `language ∈ {"python", "html"}`. Post-validation: language enum, filename safe charset (path-traversal guard via `^[\w.-]+$`), filename extension matches language, content non-empty + ≤50KB cap, run_command non-empty.
- Typed errors: `TryRefusalError` (don't retry), `TryValidationError` (caller may retry once), Anthropic SDK errors bubble.
- `src/lib/try-generation.test.ts` — 15 tests: prompt builder stability (cache discipline), python + html happy paths, cache_control assertion, refusal handling, all 6 validation rejection paths (invalid language, mismatched extension, path-traversal filename, empty content, oversized content, empty run_command, malformed JSON).
- 62 tests total now (was 47).
- **Out of scope this tick (next ticks):** FeedItem button wiring. ~30 min.

**Newly added in this tick (Day 5 server action wrapper):**
- `database.types.ts` — added `artifacts` table type + `ArtifactType` enum (`"try" | "patch"`).
- `src/app/actions.ts` — `generateTryForStory(storyId, opts?)` server action. Validates UUID, loads story by id, loads user context (currently duplicates scoring-runner's loader — flagged for follow-up extraction into `src/lib/user-context.ts`), calls `generateTry`, persists artifact to `artifacts` table with `type: "try"`, returns `{ ok, artifact, artifactId }` for the caller to render download/copy UI inline. `TryRefusalError` → friendly user message; persistence failure surfaces as a "generated but couldn't save" error so the action result is honest.
- **Test gap:** action wrapper has no unit tests yet — same reason as deferred scoring-runner tests last time (Supabase mocks add scope). The constituent pieces (`generateTry` + the duplicated loader) are tested. Worth adding 4-5 focused tests in a follow-up tick.

**Newly added in this tick (Try cost-cap fix):**
- **Bug fix:** `generateTryForStory` previously called Sonnet without going through `try_charge_budget`, violating the design doc invariant "every LLM call goes through `try_charge_budget`". Charged $0.10 per Try (conservative for Sonnet 4.6 with cached prefix + ~3-5K HTML output; actual cost ~$0.05). On `false` → friendly "Daily LLM budget exhausted" error returned, LLM not called.
- 2 new tests in `actions.test.ts`: budget-exhausted path verifies the LLM is NOT invoked, and a happy-path test asserts `rpc("try_charge_budget", { p_amount: 0.1 })` is called exactly once. 70 tests total.
- **First live Try artifact landed in DB on 2026-05-09:** story "Using Claude Code: The Unreasonable Effectiveness of HTML" → `claude_code_html_playground.html` (13KB, `open` to run). User-confirmed Day 5 #16 click-to-runnable pipeline works end-to-end.

**Earlier in this loop (Day 3 #12 ignore-weighting):**
- `card_actions` table + `CardAction` enum added to `database.types.ts`.
- `ignoreStory(storyId)` server action in `src/app/actions.ts` — UUID validation, inserts `(user_id, story_id, action="ignore")` for V1_USER_ID, revalidates `/`.
- `<FeedItemRow>`'s Ignore button now wired (was a stub) — calls `ignoreStory`, toasts confirmation. Patch button still stubbed (Day 6).
- `loadIgnoredTagUnion(supabase, userId)` in `scoring-runner.ts` — two reads (last 100 ignore card_actions → story_scores tags for those stories), returns deduplicated `Set<string>`. Empty short-circuits.
- `applyIgnorePenalty(baseScore, storyTags, ignoredTags)` pure function — `final = max(0, base − 5 × |intersection|)` capped at 30pt. Applied between `scoreStory` and `story_scores` insert, so the persisted score already reflects the penalty (no schema change needed).
- New test: "subtracts the ignore-tag penalty before persisting (Day 3 #12)" verifies the math end-to-end through the runner. 68 tests total.
- **Effect:** the next scoring pass against any not-yet-scored stories will pick up your accumulated ignores. Existing 25 scored stories were scored before any ignores existed, so they're untouched (re-scoring would require manually deleting their story_scores rows).

**Newly wired in this tick (Day 3 #12 ignore weighting + Try budget gate + ignoreStory):**
- `database.types.ts` — `card_actions` table type + `CardAction` enum (`"ignore" | "try" | "patch"`).
- `src/app/actions.ts`:
  - `ignoreStory(storyId)` server action — validates UUID, inserts `card_actions` row with `action: "ignore"`, calls `revalidatePath("/")`. Wired in `feed-item-row.tsx` Ignore button (replaces the toast stub).
  - `generateTryForStory` — added `try_charge_budget(0.10)` pre-charge BEFORE the LLM call (previously skipped). Returns "Daily LLM budget exhausted" if the cap is hit. Race-safe via the SQL function.
- `src/lib/scoring-runner.ts`:
  - `loadIgnoredTagUnion(supabase, userId)` — two reads (last 100 ignore card_actions → tags from story_scores for those story_ids) returning a `Set<string>` for O(1) lookup in the per-story loop.
  - `applyIgnorePenalty(baseScore, storyTags, ignoredTags)` — pure: `final = base − 5 × |overlap|`, capped at −30, floored at 0. Matches the design doc spec.
  - The runner loads the ignored-tag set once per pass and applies the penalty before inserting `story_scores`.
- `src/app/actions.test.ts` — 3 new tests for `ignoreStory` (invalid uuid, success path with payload assertion, supabase error propagation) + 2 new tests for the Try budget gate (budget-exhausted blocks the LLM call, charge happens exactly once on the happy path with $0.10 amount).
- `src/lib/scoring-runner.test.ts` — added an ignore-weighting test (story scored 80 with one matching tag → persisted as 75, not 80).
- 73 tests total now (was 67 → +3 ignoreStory, +2 Try budget gate, +1 ignore-weighting math).

**Browser verification attempted but blocked by headless RSC streaming.** The Claude Preview MCP couldn't hydrate the `<FeedItemRow>` client component in the tested Next.js 16 + Turbopack dev environment — buttons render but React doesn't attach event listeners (Suspense boundary streams the skeleton + content but JS hydration stalls). The action itself is unit-tested end-to-end via the `actions.test.ts` mock. Recommend a manual click in a real browser before declaring Day 3 #12 fully done.

**🟢 Day 3 smoke results (live, 2026-05-09):**
- Profile: 1378 chars seeded via Supabase Management API (user can edit at `/profile`).
- Repos: still 0. Scoring works profile-only; quality would improve with 1-3 repos pasted.
- Scoring run: 25 stories considered, 25 scored, 0 refused, 0 queued, 0 errors. Wall time ~80s. Pre-charge $0.50 (conservative; actual API cost ~$0.15-0.20 — reconciliation is v1.5).
- Score distribution: range 0-72, mean 20.2, 3 stories cleared the 60-point feed threshold.
- Top 3 (visible on `/`): "Production-grade agent skills" (72), "CLAUDE.md discipline + ts-morph refactor" (62), "Claude Code workflow insights" (62). All reference Patch + tool-use + Claude Code — strong signal that profile-driven scoring works.
- **Setup gotcha noted:** the dev shell exports `ANTHROPIC_API_KEY=` (empty) which shadows `.env.local`. Restart dev with `unset ANTHROPIC_API_KEY && bun run dev` (or `env -u ANTHROPIC_API_KEY bun run dev`). Production deploy via Vercel won't hit this.

**Earlier in this loop (Day 5 action tests):**
- `src/app/actions.test.ts` — 5 focused tests for `generateTryForStory`: invalid-uuid rejected without DB or Anthropic call, story-not-found path, happy path persists with `type: "try"` + correct payload, refusal returns user-friendly error, persist-failure honestly returns "generated but couldn't save". 67 tests total.

**Earlier in this loop (for context):**
- `src/components/feed/feed-item-row.tsx` — stateful client wrapper around the presentational `<FeedItem>`. Owns per-row Try state machine (`idle → pending → result`), invokes `generateTryForStory(item.id)` via `useTransition`, renders an inline result panel below the item with: filename header, Download button (Blob URL + `<a download>`), Copy run_command button (clipboard API with "Copied" confirmation), 2K-char preview of the artifact content, dismiss + retry buttons.
- `src/components/feed/feed-list.tsx` — now renders `<FeedItemRow>` per item instead of bare `<FeedItem>`. Empty state preserved.
- Ignore + Patch buttons remain stubs (toast info messages naming the future tick).

**Day 5 progress: ~95% complete.** Pure module ✅, server action ✅, button wiring ✅, download/copy UX ✅, tests for the module ✅. Remaining:
1. **Day 5 #16 smoke-test the 5-min bar** — click Try on 3 stories, time click-to-running. Gated on scoring having run.
2. Action unit tests for `generateTryForStory` (deferred from earlier tick).
3. (Optional polish) Loading skeleton inside the result panel during the 10-20s wait.

**Newly added in this tick (part B of #3):**
- `src/lib/scoring-runner.ts` — `runScoringPass({ userId, limit?, budgetPerCall?, supabase?, scoringDeps? })`. Loads user context once, selects up to 25 unscored stories oldest-first (manual anti-join via two reads — adequate for v1 scale), iterates with: `try_charge_budget` → `scoreStory` → insert `story_scores`. `ScoringRefusalError` → counts as `refused`, no queue. Other errors → `scoring_retry_queue` upsert (PK conflict ignored). Budget exhaustion stops the loop early. Returns a `ScoringRunSummary` JSON.
- `src/app/api/cron/score/route.ts` — thin GET handler with the same `Bearer $CRON_SECRET` auth pattern as `/api/cron/ingest`. Calls `runScoringPass({ userId: V1_USER_ID })`.
- `vercel.json` — added cron `17 * * * *` for `/api/cron/score` (hourly, off the :00/:30 thundering herd).
- `database.types.ts` — added `story_scores`, `scoring_retry_queue` tables and `try_charge_budget` function type.

**Newly added in this tick (`/` real-feed read):**
- `src/lib/feed.ts` — `loadFeedItems(userId)` (reads `story_scores → stories → sources` via PostgREST nested select, score >= 60, ordered desc, limit 50, mapped to existing `FeedItemData`) + `loadLastCronRunAt()` (most recent `sources.last_run_at WHERE last_status = 'success'`).
- `src/app/page.tsx` — async server component, parallel data fetch, sample data removed, design-preview `?state=` toggles retired (loading state now triggers naturally via `app/loading.tsx` while DB queries resolve).
- Source slug → friendly label mapping: `hn-algolia-ai` → "Hacker News", `github-trending-ai` → "GitHub Trending", `anthropic-blog` → "Anthropic Blog". Other slugs get title-cased via fallback.
- Verified live: `GET /` returns 200 and renders the empty state (no scores exist yet).

**Test gap closed in earlier tick:**
- `src/lib/scoring-runner.test.ts` — 7 tests covering: zero-unscored no-op, happy-path insert, budget exhaustion stops loop, refusal counts as `refused` (no queue write), other errors push to `scoring_retry_queue` with the failure reason, anti-join excludes already-scored stories, missing-user throws (config error). Built a minimal thenable+chainable Supabase builder mock since the runner uses ~7 distinct chain shapes — kept it inline rather than ship a test util.
- Side-fix: `src/lib/supabase/server.ts` and `auth.ts` switched from `@/lib/server-env` (path alias) to `../server-env` (relative) so vitest can resolve them without a separate path-alias config. Same fix that was already applied to `scoring.ts` and `github.ts`.

**Next tick — live smoke (STILL gated on user action):**
1. **PRE-REQ:** Paste real content into http://localhost:3000/profile — your stack, current projects, what you want to learn. Quality of `why_i_care` scales linearly with profile specificity. **As of this tick, `users.profile_md` is still 0 chars — verified via Management API.**
2. Trigger: `curl -i http://localhost:3000/api/cron/score -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"`
3. Expect: HTTP 200 + JSON like `{ considered: 25, scored: 25, refused: 0, queued: 0, budgetExhausted: false, errors: [] }`. ~25 Sonnet calls; first call ~$0.04 (cache write), rest ~$0.01 each (cache read) → ~$0.30 total. Daily cap is $5; well under.
4. Verify in DB: `select score, why_i_care, array_to_string(tags, ',') from story_scores order by score desc limit 5;` — eyeball whether scores and "why_i_care" lines feel right for the pasted profile. If scores feel uncalibrated or tags feel off, iterate on the prompt rubric in `src/lib/scoring.ts`.
5. After smoke passes: add the deferred runner tests, then start the next milestone (read `story_scores` on `/`).

Once #3b smokes clean, `/` swaps sample data for `stories JOIN story_scores WHERE user_id = ? AND score >= 60 ORDER BY score DESC` — natural follow-up tick. Day 3 #12 (ignore-weighting math: subtract 5pt per matching tag from user's last 100 ignores) also waits for that point — no `card_actions` rows exist until the feed renders real cards with working buttons.

The plan for every day after that is in the design doc at `~/.gstack/projects/daily-ai-updates/truman-nobranch-design-20260507-142511.md` → "Next Steps" section.

## Source-of-truth files

| File | What it is | When to read it |
|---|---|---|
| `~/.gstack/projects/daily-ai-updates/truman-nobranch-design-20260507-142511.md` | Approved design doc (8/10, ENG + DESIGN cleared via /plan-eng-review and /plan-design-review) | Always — this is the canonical plan, premises, schema, day-by-day timeline |
| `DECISIONS.md` (this repo root) | Architecture Decision Records, append-only | When making a structural call. D1 documents why Horizon was abandoned for greenfield |
| `AGENTS.md` / `CLAUDE.md` | Project conventions, stack, aesthetic, gotchas | Every session start |
| `HANDOFF.md` (this file) | Where you are RIGHT NOW + what to do next | Every session start, after the design doc |
| `supabase/migrations/20260508000001_initial_schema.sql` | Full schema with RLS, indexes, atomic budget fn, pgcrypto wrappers | When applying the schema or extending it |

## What's shipped

### Day 0 — Horizon spike
- Cloned Horizon, read its source, decided **greenfield** over fork
- Verdict + reasoning + citations in `DECISIONS.md` D1
- Design doc's "Recommended Approach" was updated to point to the decision

### Day 1 — Scaffold + design tokens
- Next.js 16 (app router, Turbopack), React 19, TypeScript strict, Bun
- Tailwind v4 with our design tokens (dark-only, Geist Sans/Mono, `#CC7849` accent)
- shadcn/ui installed: Button, Skeleton, Sonner, DropdownMenu, Textarea
- Supabase migration written (not yet applied — needs cloud project)
- Layout shell: `TopNav`, `LastCronRun` footer badge
- Pages: `/` feed, `/profile` editor, `/repos` list, `/sign-in` magic-link form (all visual placeholders)
- Build green, 5 routes prerender

### Day 1 polish (round 1) — visual hierarchy + identity
- Sharper sample item content (specific "why I care" lines)
- "Why I care" line bumped to 24px / leading-tight (the spine of the design)
- Title de-emphasized to muted small text (it's context, not the hero)
- Per-source colored dot before source name (Anthropic orange, HN orange, GitHub purple, arXiv red, OpenAI green)
- Hover state: 2px orange left edge slides in (sets up future j/k vim nav visual)
- Top nav wordmark: `▌ daily ai` — orange block as favicon-style mark

### Day 1 polish (round 2) — density + grain + skeleton
- Density: `py-8 gap-4` → `py-5 gap-3` (5 items per viewport target met)
- Background grain: 3% SVG fractal noise, fixed-position, ignores pointer events, GPU-cheap
- `<FeedSkeleton />` component + `app/loading.tsx` + `?state=loading|empty` toggle on `/`

### Day 2 wiring — Supabase helpers + ingestion cron
- Installed `@supabase/supabase-js`, `@supabase/ssr`, `rss-parser`, `cheerio`, and `vitest`
- Added lazy Supabase helpers:
  - `src/lib/supabase/server.ts` — service-role admin client for cron/admin paths
  - `src/lib/supabase/client.ts` — browser anon client for future RLS reads
  - `src/lib/supabase/auth.ts` — async-cookie server client helper for Supabase Auth
- Added v1 source connectors:
  - `src/lib/sources/anthropic-blog.ts` — RSS parse/fetch
  - `src/lib/sources/github-trending.ts` — GitHub Trending HTML scrape + AI keyword filter
  - `src/lib/sources/hn-algolia.ts` — HN Algolia keyword queries + objectID dedupe
- Added connector tests next to code (`*.test.ts`) and `bun run test`
- Added `src/lib/ingestion.ts`:
  - Ensures the 3 source rows exist
  - Runs each connector with 3 retries (1s/2s/4s)
  - Truncates story bodies to 10KB
  - Inserts stories with URL dedupe
  - Updates `sources.last_run_at` / `last_status`
  - Writes `ingestion_log`
- Added `src/app/api/cron/ingest/route.ts`:
  - Requires `Authorization: Bearer $CRON_SECRET`
  - Returns 401 for missing/wrong bearer token
  - Returns JSON run summary for successful authorized runs
  - Catches top-level ingestion errors and returns JSON `{ status: "failure" }`
- Added `vercel.json` cron schedule: `0 13 * * *`
- Fixed React 19 lint purity issue in `<LastCronRun>` by moving relative-time ticking client-side
- Verification on 2026-05-09:
  - `bun run test` ✅
  - `bun run lint` ✅
  - `bun run build` ✅ (first sandboxed attempt failed only because Google font fetch was blocked; rerun with network approval passed)

## What's running

| Surface | URL | Status |
|---|---|---|
| Dev server | http://localhost:3000 | Running (PID 91288, started outside our session — `bun run dev` will fail to start a second one) |
| `/` (feed) | http://localhost:3000 | 4 sample items, design tokens applied |
| `/?state=loading` | http://localhost:3000/?state=loading | Skeleton preview (5 placeholders) |
| `/?state=empty` | http://localhost:3000/?state=empty | Empty state ("Your feed is being personalized...") |
| `/profile` | http://localhost:3000/profile | Textarea editor placeholder |
| `/repos` | http://localhost:3000/repos | Repo list placeholder |
| `/sign-in` | http://localhost:3000/sign-in | Magic-link form placeholder |
| `/api/cron/ingest` | http://localhost:3000/api/cron/ingest | Code wired; needs `CRON_SECRET` + Supabase env + migrated DB for live smoke |
| Supabase | n/a | Not yet created (cloud project), migration not yet applied |

## How to resume

```bash
cd /Users/truman/Projects/daily-ai-updates

# If dev server isn't running:
bun run dev                 # http://localhost:3000

# If port 3000 is taken (the autoPort flag in .claude/launch.json handles this):
# Either kill the squatter or accept the alternate port Next prints

bun run build               # smoke-test the whole thing compiles
bun run lint                # ESLint — currently clean
```

## Day 2 — Where to start (concrete)

### 2.1 Supabase cloud project (~15 min)
1. Sign up / sign in at https://supabase.com
2. Create a new project. Region: closest to you. DB password: save it somewhere
3. From the project's Settings → API, grab:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — never client-side)
4. Drop them in `.env.local` (which you'll also need to add to `.gitignore` — currently the gitignore is the create-next-app default; verify `.env*` is covered)

### 2.2 Apply the migration (~5 min)
Two paths:
- **Easy:** open the project's SQL Editor in the Supabase dashboard, paste the contents of `supabase/migrations/20260508000001_initial_schema.sql`, run it
- **Right:** install the `supabase` CLI (`brew install supabase/tap/supabase`), run `supabase login`, then `supabase link --project-ref <ref>`, then `supabase db push`. The CLI path sets you up for future migrations to be tracked.

After it runs, verify in the Table Editor that you see all 13 tables (sources, stories, story_scores, users, user_repos, card_actions, artifacts, usage_meter, cost_ledger, ingestion_log, patch_log, scoring_retry_queue, invites) and the 3 sources are seeded.

### 2.3 Wire `@supabase/supabase-js` (~30 min) — DONE
Done in code on 2026-05-09. Live validation still waits on `.env.local` + migrated Supabase project.

### 2.4 Three source connectors (~3-4 hr) — DONE IN CODE
Each connector lives at `src/lib/sources/<name>.ts` and exports `fetchStories(): Promise<StoryDraft[]>`. Each gets a fixture-based test next to it (per /plan-eng-review D4 — critical-path tests).

Spec from the design doc → "Recommended Approach → Ingestion layer":

| Source | URL | Library | Filter |
|---|---|---|---|
| `anthropic-blog.ts` | `https://www.anthropic.com/news/rss.xml` | `rss-parser` | none — Anthropic posts are all relevant |
| `github-trending.ts` | scrape `https://github.com/trending?since=daily` | `cheerio` (or `node-html-parser`) | keyword set against repo description + topics |
| `hn-algolia.ts` | `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=<kw>` | native `fetch` | search per keyword, dedupe by `objectID` |

Keyword set: `["llm","ai","agent","rag","embedding","transformer","diffusion","openai","anthropic","claude","gpt"]`

Each connector returns a normalized `StoryDraft` shape. Ingestion writer (next step) inserts into `public.stories` with `body` truncated to 10KB.

### 2.5 `/api/cron/ingest` route handler (~1 hr) — DONE IN CODE
- `src/app/api/cron/ingest/route.ts`
- Bearer token check against `process.env.CRON_SECRET`. Wrong/missing token → 401
- For each of the 3 sources, run with 3-retry exponential backoff (1s/2s/4s)
- On success: dedupe new items by URL hash, insert into `stories` table
- On final failure: insert row in `ingestion_log` with `status='failure'` and the error text, continue to the next source
- Always return 200 — the cron should never fail; it just produces fewer cards on bad days
- Add `vercel.json` with the cron entry: `{ "path": "/api/cron/ingest", "schedule": "0 13 * * *" }` (UTC = 6am PDT / 5am PST)

### 2.6 Smoke-test the loop (~15 min)
- Manually trigger the cron endpoint with the secret: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest`
- Check the Supabase Table Editor for new rows in `stories`
- Verify `ingestion_log` has at least one success row per source

When this works end-to-end, Day 2 is complete. The feed page still shows hand-written samples — Day 3 wires real reads.

## Days 3-7 — Roadmap

Just the headlines. Full detail in the design doc.

- **Day 3** — `/profile` save action, `/repos` paste-and-fetch, scoring loop with prompt-cached per-(user, story) scoring, ignore weighting formula (`final_score = base - 5 × num_distinct_ignored_tags_intersecting_story_tags`, capped at 30)
- **Day 4-5** — Wire feed page to read from `story_scores`, infinite scroll via `react-intersection-observer`, Try server action (Sonnet → single-file Python or HTML, 5-min-to-run bar)
- **Day 6** — Patch tool-use loop (Opus + `list_repo_files` + `get_file`, max 8 fetches caller-enforced, HTTP 422 on overflow). **Riskiest day.** Feature flag fallback (`FEATURE_PATCH_ENABLED=false`) if EOD smoke-test fails — do NOT slip the 7-day ship for Patch polish
- **Day 7** — Supabase Auth magic-link, invite tokens, Vercel deploy, end-to-end smoke
- **Days 8-21** — Dogfood. No new features. Frictions go in `FRICTIONS.md` for the v2 backlog

## Things you'll trip on

- **Port 3000** is held by an external Next dev process (PID 91288). The `.claude/launch.json` has `autoPort: true` so Claude's preview tool will use whatever's free. If you start dev manually with `bun run dev` and 3000 is taken, Next will pick an alternate (its log shows the actual URL).
- **shadcn `--accent` is NOT our brand accent.** shadcn uses `--primary` for brand and `--accent` for "subtle interactive surfaces." Our globals.css follows that semantic. `--primary = #cc7849`, `--accent = #141414`. Don't fix this; understand it.
- **Patch's tool-use loop** is the riskiest single feature. Caller-side max iterations enforcement is non-negotiable per /plan-eng-review D1 (the SDK doesn't enforce). Day 6 ships with the feature flag to avoid timeline slip.
- **Cost cap is race-safe** via the `try_charge_budget()` Postgres function. Do NOT call `UPDATE cost_ledger SET usd_spent = usd_spent + N` directly anywhere — that has a TOCTOU race.
- **Email rate limit** is 3/hour on Supabase's built-in mailer (decided in /plan-eng-review D1). Stagger invites manually on launch day. Switch to Resend free tier in v2 if it bites.
- **OpenAI API key issue** — at one point the gstack design tool returned 429 "quota exceeded" despite the user's billing showing $9 of $100 used. Likely a per-project rate limit on parallel image generation, not actual quota. Check `~/.gstack/openai.json` or `OPENAI_API_KEY` env when ready to retry mockups via `/design-shotgun`.

## Open questions parked for the right moment

- Light mode toggle: deferred to v2. If a friend asks for it during dogfood, log to `FRICTIONS.md`
- Cron same-day verification: the `/api/cron/ingest` endpoint accepts manual triggers via `CRON_SECRET` so you can test post-deploy without waiting for 6am UTC
- Multi-tenancy in v1.5: schema is RLS-ready; the actual invite redemption flow ships in Day 7 but is mostly unused until friends are invited in week 3+
- Empty-feed-on-signup backfill: deferred to v1.5 (per /plan-eng-review D2). When the first friend signs up, add a per-user backfill pass over the last 24h of stories
