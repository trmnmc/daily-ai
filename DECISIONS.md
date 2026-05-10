# Decisions

## D1 — Horizon spike verdict: GREENFIELD (Approach B)

**Date:** 2026-05-08
**Source:** `/plan-eng-review` Day 0 gate, executed via Claude Code session
**Verdict:** Abandon Approach A (Fork Horizon). Proceed with **Approach B (Greenfield Next.js + Build-Queue Architecture).** Realistic effort: 6-8 days, not the 8-12 originally estimated.

### Gate criterion (from eng review)

> "Does Horizon's ingestion code write to a swappable persistence layer (interface/adapter), or is it tightly coupled to its own DB schema? If swappable → fork. If coupled → either rewrite its persistence layer (1+ day cost) or abandon Horizon for Approach B greenfield."

### Findings

**1. Horizon has no database. Storage is file-based JSON + Markdown.**

`src/storage/manager.py:13-19` shows `StorageManager` is hardcoded to filesystem paths:

```python
class StorageManager:
    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)
        self.config_path = self.data_dir / "config.json"
        self.summaries_dir = self.data_dir / "summaries"
```

The "swappable persistence" question is moot — Horizon doesn't persist to a DB at all. The orchestrator at `src/orchestrator.py:129` calls `self.storage.save_daily_summary(today, summary, language=lang)` which writes a Markdown file to disk. There is no DB hook to redirect.

To use Supabase, we'd have to:
- Rip out `StorageManager.save_daily_summary` entirely
- Replace it with Postgres inserts using the (different) schema we designed
- Wire a new persistence layer through the orchestrator's pipeline
- Rebuild the email/webhook delivery hooks that depend on the file output

That's surgery, not "fork and configure."

**2. Horizon is Python. Our stack is Next.js + TypeScript.**

`pyproject.toml`:
```toml
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27.0", "feedparser>=6.0.11", "anthropic>=0.39.0", ...
]
```

Forking Horizon means running a Python service alongside the Next.js app. Two deploy targets (Vercel for Next.js, somewhere for Python — Railway, Fly, or Docker on a VPS), two language ecosystems to maintain, two CI pipelines. The "30% time savings" the design doc claimed evaporates against the deployment cost.

The MCP server (`src/mcp/`) doesn't escape this — `horizon-mcp` is also Python. Calling it from Next.js requires the Python process to be running somewhere.

**3. Horizon does more than v1 needs. Cutting it down is more work than writing 3 simple scrapers.**

Horizon ships scrapers for: GitHub user events / repo releases, Hacker News, RSS, Reddit, Telegram, Twitter/X. Plus enrichment, comment summarization, multi-language briefings, email subscription management, webhook delivery to Feishu/Slack/Discord/etc.

v1 needs: Anthropic blog RSS, GitHub Trending scrape, HN Algolia search. Three sources, no enrichment, no email, no multi-language, no webhooks.

Estimated TS implementation:
- Anthropic blog via `rss-parser`: ~30 LOC
- HN Algolia via `fetch`: ~30 LOC
- GitHub Trending scrape via `cheerio`: ~50 LOC
- Dedupe by URL hash: ~10 LOC
- Sonnet scoring loop with prompt cache: ~80 LOC
- Vercel Cron endpoint with auth: ~40 LOC

Total: ~250 LOC of ingestion code. Sonnet writes that in an afternoon. The pieces of Horizon that AREN'T this 250 LOC are pieces we'd have to remove.

**4. ContentItem maps cleanly to our `stories` table — but not perfectly.**

`src/models.py:19`:
```python
class ContentItem(BaseModel):
    id: str  # Format: {source}:{subtype}:{native_id}
    source_type: SourceType
    title: str
    url: HttpUrl
    content: Optional[str] = None
    author: Optional[str] = None
    published_at: datetime
    fetched_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    # AI analysis results
    ai_score: Optional[float] = None  # 0-10 importance score
    ai_reason: Optional[str] = None
    ai_summary: Optional[str] = None
    ai_tags: List[str] = Field(default_factory=list)
```

Differences from our schema:
- `ai_score` is global (one score per item); our `story_scores` is per-(user, story). We'd have to bypass Horizon's scoring entirely and write our own per-user scoring pass.
- `ai_summary` is a fixed-language string; our `why_i_care` is per-user contextual. Same — bypass.
- `ai_tags` is generic; our tags drive the Ignore weighting. Compatible but we'd want to control the prompt.
- `ai_score` 0-10 vs our 0-100 — trivial to translate but signals the impedance.

We'd be running Horizon's pipeline only for the fetch+dedup steps, then skipping its scoring entirely. That's like buying a car for the wheels.

### Verdict reasoning

The eng review estimated Approach A at "M (5-7 days), Low risk" assuming Horizon was a library with a swappable DB layer. It is neither. Approach A's actual cost includes:
- Python service deployment + maintenance (~1 day extra)
- Persistence layer rewrite (~1-2 days)
- Cutting Horizon down to 3 sources (~0.5 days)
- Bypassing Horizon's scoring entirely (~0 days saved — we write our own anyway)

Approach A's realistic cost: 7-9 days, Medium risk (deployment complexity).

Approach B (greenfield) was estimated at "L (8-12 days), Medium risk." With this analysis:
- The 3 scrapers are ~110 LOC (~0.5 day)
- Dedup + scoring are pieces we'd write either way (~1 day)
- No Python deployment
- No persistence-layer surgery
- Single language ecosystem

Approach B's realistic cost: **6-8 days, Low risk.**

**Approach B is now both the cleaner architecture AND the faster path.** This inverts the eng review's recommendation, but only because the eng review's assumption about Horizon was wrong (understandable — the design doc author hadn't read Horizon's source).

### Implications for the design doc

The design doc's "Recommended Approach" section mentions Horizon as the v1 base. This decision supersedes that. Day 0 spike resolved: greenfield. Update the design doc's "Recommended Approach" header to reflect.

The 7-day timeline in the design doc remains achievable (6-8 days realistic estimate, no Python overhead), so no timeline slip.

### What we keep from Horizon

Patterns to study (without depending on the code):
- The `ContentItem` shape is a good reference for our `stories` schema (already in design doc).
- Their per-source rate-limit + retry handling in scrapers is a sane reference (already covered by design doc's 3-retry exponential backoff spec).
- Their dedupe-by-URL approach (`src/orchestrator.py:317 merge_cross_source_duplicates`) is straightforward — we can mirror it in TS.

### Action items

1. Delete `/tmp/horizon-spike` (no longer needed; design doc cites learnings).
2. Update the design doc's Recommended Approach to "Approach B (Greenfield)" with a one-line note pointing to this DECISIONS.md entry.
3. Proceed to Day 1: scaffold Next.js + TypeScript + Tailwind + shadcn project. Init Supabase project. Apply the data-model migration from the design doc.

---

## How to read this file

This is an Architecture Decision Record (ADR). Each entry is a `## D<N> — <Decision title>` followed by date, source, verdict, findings, reasoning, and action items. New decisions append to the bottom. Old entries are never edited or removed — they're the project's audit trail. If a decision gets revised later, write a new entry that supersedes the old one.
