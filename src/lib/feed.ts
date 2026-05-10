import type { SupabaseClient } from "@supabase/supabase-js";

import type { FeedItemData } from "@/components/feed/feed-item";

import { getSupabaseAdminClient } from "./supabase/server";
import type { Database } from "./supabase/database.types";

/**
 * Server-side data layer for the feed page.
 *
 * Reads `story_scores JOIN stories JOIN sources` for one user, score >= 60,
 * ordered desc. Maps the DB rows to the `FeedItemData` shape the existing
 * `<FeedItem>` component already consumes — keeps the design surface
 * unchanged while swapping in real data.
 *
 * Score floor (60) and limit (50) match the design doc:
 *   - Day 7 target: ~10-30 cards visible per user per day from ~50-100 ingested
 *   - Index `idx_story_scores_user_score` is on `(user_id, score desc)` so
 *     this query hits the index directly.
 */

const SCORE_FLOOR = 60;
const FEED_LIMIT = 50;

/**
 * Shape Supabase returns for the nested select. Kept narrow on purpose —
 * adding fields here is the cheapest place to widen the query without
 * touching the FeedItemData mapping.
 */
type FeedRow = {
  score: number;
  why_i_care: string;
  story: {
    id: string;
    title: string;
    url: string;
    fetched_at: string;
    source: { name: string } | null;
  } | null;
};

export async function loadFeedItems(
  userId: string,
  supabase: SupabaseClient<Database> = getSupabaseAdminClient(),
): Promise<FeedItemData[]> {
  const { data, error } = await supabase
    .from("story_scores")
    .select(
      "score, why_i_care, story:stories!inner(id, title, url, fetched_at, source:sources!inner(name))",
    )
    .eq("user_id", userId)
    .gte("score", SCORE_FLOOR)
    .order("score", { ascending: false })
    .limit(FEED_LIMIT);

  if (error) {
    throw new Error(`Failed to load feed: ${error.message}`);
  }

  // PostgREST nested select types come back loose; narrow + filter out anything
  // missing the join targets (shouldn't happen with !inner but defensive).
  const rows = (data ?? []) as unknown as FeedRow[];
  return rows.flatMap((r) => {
    if (!r.story || !r.story.source) return [];
    return [
      {
        id: r.story.id,
        source: prettySourceName(r.story.source.name),
        timestamp: relativeTimeFromNow(r.story.fetched_at),
        title: r.story.title,
        whyICare: r.why_i_care,
        url: r.story.url,
      },
    ];
  });
}

/**
 * Most recent successful ingest timestamp across all sources, for the
 * `<LastCronRun>` footer badge. Returns null if no source has ever succeeded
 * (the badge component handles that case explicitly).
 */
export async function loadLastCronRunAt(
  supabase: SupabaseClient<Database> = getSupabaseAdminClient(),
): Promise<string | null> {
  const { data, error } = await supabase
    .from("sources")
    .select("last_run_at, last_status")
    .eq("last_status", "success")
    .order("last_run_at", { ascending: false })
    .limit(1);

  if (error) {
    // Don't let the badge break the page render — log via thrown error so
    // Next.js error boundary catches it, but the page caller can also choose
    // to swallow this. For v1 we let it bubble.
    throw new Error(`Failed to load last cron run: ${error.message}`);
  }

  return data?.[0]?.last_run_at ?? null;
}

/**
 * Source names in the DB are slugs (`hn-algolia-ai`, `github-trending-ai`,
 * `anthropic-blog`). The dot-color logic in `<FeedItem>` already does
 * substring matching ("anthropic", "hacker news", "github"), but the human
 * label benefits from cleanup.
 */
function prettySourceName(slug: string): string {
  switch (slug) {
    case "hn-algolia-ai":
      return "Hacker News";
    case "github-trending-ai":
      return "GitHub Trending";
    case "anthropic-blog":
      return "Anthropic Blog";
    default:
      // Fallback: turn `something-else` into `Something Else`
      return slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

/**
 * Server-rendered relative time. Same shape as the in-page formatter on
 * `/repos`, intentionally hand-rolled to avoid a date-fns dep. Stable within
 * a single render; the client never re-ticks (the freshness signal is
 * `<LastCronRun>` in the footer, which does tick).
 */
function relativeTimeFromNow(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
