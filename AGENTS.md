<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (16.x) has breaking changes from earlier majors — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# daily-ai-updates — project conventions

**What this is:** A personalized AI news feed with tri-action cards (Ignore / Try / Patch). Side project; v1 ships in 7 days for the project owner first, with magic-link invites for ~5 friends in v1.5.

**Source of truth for design + architecture:**
- `~/.gstack/projects/daily-ai-updates/truman-nobranch-design-20260507-142511.md` — the approved design doc (8/10, ENG + DESIGN cleared)
- `DECISIONS.md` (this repo root) — Architecture Decision Records, append-only

**Stack:**
- Next.js 16 (app router, server actions, Turbopack), React 19, TypeScript strict
- Tailwind v4 + shadcn/ui (Button, Skeleton, Sonner, DropdownMenu, Textarea installed; expand by need)
- Supabase Postgres + Supabase Auth (magic-link, built-in 3/hr email — accepted v1 limitation)
- Anthropic SDK: Sonnet 4.6 for scoring + Try, Opus 4.7 for Patch (tool-use loop, max 8 iterations, caller-enforced)
- Vercel + Vercel Cron (Hobby tier sufficient for v1)
- Bun (package manager + script runner; `bun install`, `bun run dev`, `bun run build`)

**Aesthetic:**
- Minimal as position, not default
- Dark-only in v1 (light mode is v2). `<html class="dark">` is hardcoded.
- Geist Sans for UI, Geist Mono for code/inline tokens
- Single accent: `#CC7849` (Anthropic warm orange) — only on `--primary` and `--ring`
- **No cards.** Feed renders as a vertical list with `divide-y divide-border` (1px hairlines at 8% alpha — Linear's pattern)
- Touch targets ≥44px (use `.tap-target` utility), `j`/`k` vim nav planned, axe-core in CI

**Conventions:**
- TypeScript strict mode (default; do not weaken)
- Prettier + ESLint defaults (do not customize until friction shows up)
- Conventional commits NOT required for v1; commit liberally to `main`
- File layout: `src/app/<route>/page.tsx`, `src/components/<feature>/<Component>.tsx`, `src/lib/<domain>.ts`
- Server actions in `src/app/<route>/actions.ts`; route handlers in `src/app/api/<route>/route.ts`
- Tests live next to code: `foo.test.ts` next to `foo.ts`. Vitest + Playwright. Critical-path coverage only in v1 (per /plan-eng-review D4)

**Day-by-day plan:** see the design doc's "Next Steps" section. Day 0 (Horizon spike) is done — verdict in `DECISIONS.md` D1: **greenfield, not Horizon fork**. Day 1 scaffold is complete (this commit). Days 2-7 ahead.

**Things that will trip you up:**
- shadcn's `--accent` is NOT our brand accent. shadcn uses `--primary` for brand, `--accent` for "subtle interactive surfaces" (dropdown hover etc). Our `globals.css` follows that semantic — `--primary` is `#CC7849`, `--accent` is `#141414`.
- Patch's tool-use loop is the riskiest piece in v1. If Day 6 smoke-test fails, ship with `FEATURE_PATCH_ENABLED=false` (feature flag fallback) — do NOT slip the 7-day ship.
- Cost cap is race-safe via the `try_charge_budget()` Postgres function. Do NOT call `UPDATE cost_ledger SET usd_spent = usd_spent + N` directly — that has a TOCTOU race.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
