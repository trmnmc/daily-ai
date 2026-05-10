import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getScoringDeps,
  scoreStory,
  ScoringRefusalError,
  ScoringValidationError,
  type RepoSnippet,
  type ScoringDeps,
  type StoryToScore,
  type UserScoringContext,
} from "./scoring";
import { getSupabaseAdminClient } from "./supabase/server";
import type { Database, Json } from "./supabase/database.types";

/**
 * Orchestrates a single scoring pass for one user.
 *
 * Pipeline:
 *   1. Load user context (profile_md + repos) ONCE per pass.
 *   2. Select up to N stories that don't yet have a story_scores row for this
 *      user, oldest-first (so the cron eventually catches up).
 *   3. For each story:
 *      a. Atomically charge the daily budget. If false → stop.
 *      b. Call scoreStory. On refusal → skip (no retry). On other errors →
 *         push to scoring_retry_queue and continue.
 *      c. Insert into story_scores.
 *   4. Return a summary suitable for direct JSON response.
 *
 * v1 has one user (V1_USER_ID), so the design doc's "for user → for story"
 * loop ordering reduces to a single inner loop. Sonnet's prompt cache stays
 * warm across all stories in this pass — the system prompt is constant.
 *
 * Idempotent: re-running won't re-score stories that already have a row.
 * The unique constraint on (story_id, user_id) provides a backstop.
 *
 * Failure isolation: an exception scoring story N is logged + pushed to the
 * retry queue; the loop continues with story N+1. Only budget exhaustion
 * stops the pass.
 */

export type ScoringRunSummary = {
  startedAt: string;
  finishedAt: string;
  userId: string;
  considered: number;
  scored: number;
  refused: number;
  queued: number;
  budgetExhausted: boolean;
  errors: Array<{ storyId: string; reason: string }>;
};

export type ScoringRunOptions = {
  userId: string;
  /** Max stories per pass. Bounds tick duration + worst-case cost. Default 25. */
  limit?: number;
  /** Pre-charge per scoring call. Conservative; profile + 5 repos cached + ~2K story body. Default $0.02. */
  budgetPerCall?: number;
  supabase?: SupabaseClient<Database>;
  scoringDeps?: ScoringDeps;
};

const DEFAULT_LIMIT = 25;
const DEFAULT_BUDGET_PER_CALL = 0.02;

export async function runScoringPass(
  opts: ScoringRunOptions,
): Promise<ScoringRunSummary> {
  const startedAt = new Date().toISOString();
  const supabase = opts.supabase ?? getSupabaseAdminClient();
  const scoringDeps = opts.scoringDeps ?? getScoringDeps();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const budgetPerCall = opts.budgetPerCall ?? DEFAULT_BUDGET_PER_CALL;

  const summary: ScoringRunSummary = {
    startedAt,
    finishedAt: startedAt,
    userId: opts.userId,
    considered: 0,
    scored: 0,
    refused: 0,
    queued: 0,
    budgetExhausted: false,
    errors: [],
  };

  const userContext = await loadUserContext(supabase, opts.userId);
  // Day 3 #12: union of tags from the user's last-100 ignored stories.
  // Each match in the new story's tags shaves 5 pts off, capped at 30.
  const ignoredTags = await loadIgnoredTagUnion(supabase, opts.userId);
  const stories = await loadUnscoredStories(supabase, opts.userId, limit);
  summary.considered = stories.length;

  for (const story of stories) {
    // Pre-charge the budget. The function is race-safe; multiple parallel
    // crons can't co-overspend.
    const { data: charged, error: chargeError } = await supabase.rpc(
      "try_charge_budget",
      { p_amount: budgetPerCall },
    );
    if (chargeError) {
      // Treat charge errors as transient — push to queue and stop the pass.
      // We don't know if other stories would also fail, but we don't want to
      // burn the rest of the budget if the ledger is wedged.
      summary.errors.push({
        storyId: story.id,
        reason: `try_charge_budget error: ${chargeError.message}`,
      });
      await enqueue(supabase, story.id, opts.userId, chargeError.message);
      summary.queued += 1;
      summary.budgetExhausted = true;
      break;
    }
    if (charged === false) {
      summary.budgetExhausted = true;
      break;
    }

    try {
      const result = await scoreStory(scoringDeps, userContext, story);
      const adjustedScore = applyIgnorePenalty(result.score, result.tags, ignoredTags);
      const { error: insertError } = await supabase
        .from("story_scores")
        .insert({
          story_id: story.id,
          user_id: opts.userId,
          score: adjustedScore,
          why_i_care: result.why_i_care,
          tags: result.tags,
        });
      if (insertError) {
        // Insert failure after we already paid. Log + queue so the next pass
        // re-attempts. The unique constraint protects against double-insert.
        summary.errors.push({
          storyId: story.id,
          reason: `story_scores insert: ${insertError.message}`,
        });
        await enqueue(supabase, story.id, opts.userId, insertError.message);
        summary.queued += 1;
        continue;
      }
      summary.scored += 1;
    } catch (err) {
      if (err instanceof ScoringRefusalError) {
        // Sonnet refused; do NOT retry. Log only.
        summary.errors.push({ storyId: story.id, reason: err.message });
        summary.refused += 1;
        continue;
      }

      // Validation glitches and SDK errors both go to the retry queue. The
      // next pass will re-attempt. Bounded re-attempts are a v1.5 problem;
      // until then the queue can grow unbounded but stays trivially small in
      // practice (50-100 stories/day, transient errors are rare).
      const reason = describeError(err);
      summary.errors.push({ storyId: story.id, reason });
      await enqueue(supabase, story.id, opts.userId, reason);
      summary.queued += 1;
    }
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}

/**
 * Compute the ignore-tag union for this user.
 *
 * Two reads (avoids brittle PostgREST nested joins on a composite-PK table):
 *   1. Last 100 ignore card_actions for this user, newest-first.
 *   2. Tags column from story_scores for those story_ids (this user only).
 *
 * Returns the deduplicated union as a Set for O(1) lookup in the scoring loop.
 * Empty set when the user has no ignores yet (early-return short-circuit).
 */
async function loadIgnoredTagUnion(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Set<string>> {
  const { data: ignores, error: ignoreErr } = await supabase
    .from("card_actions")
    .select("story_id")
    .eq("user_id", userId)
    .eq("action", "ignore")
    .order("created_at", { ascending: false })
    .limit(100);
  if (ignoreErr) {
    throw new Error(`Failed to load ignores: ${ignoreErr.message}`);
  }
  const ignoredStoryIds = Array.from(
    new Set((ignores ?? []).map((r) => r.story_id)),
  );
  if (ignoredStoryIds.length === 0) return new Set();

  const { data: scoreRows, error: scoreErr } = await supabase
    .from("story_scores")
    .select("tags")
    .eq("user_id", userId)
    .in("story_id", ignoredStoryIds);
  if (scoreErr) {
    throw new Error(`Failed to load tags for ignored stories: ${scoreErr.message}`);
  }

  const out = new Set<string>();
  for (const row of scoreRows ?? []) {
    for (const tag of row.tags) out.add(tag);
  }
  return out;
}

/**
 * Pure function: penalty math from the design doc:
 *   final = base − 5 × |story.tags ∩ ignored_tags|, capped at −30, floored at 0
 */
const IGNORE_PENALTY_PER_TAG = 5;
const IGNORE_PENALTY_CAP = 30;
function applyIgnorePenalty(
  baseScore: number,
  storyTags: string[],
  ignoredTags: Set<string>,
): number {
  if (ignoredTags.size === 0) return baseScore;
  const matched = new Set(storyTags.filter((t) => ignoredTags.has(t)));
  const penalty = Math.min(matched.size * IGNORE_PENALTY_PER_TAG, IGNORE_PENALTY_CAP);
  return Math.max(0, baseScore - penalty);
}

async function loadUserContext(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserScoringContext> {
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("profile_md")
    .eq("id", userId)
    .maybeSingle();
  if (userErr) {
    throw new Error(`Failed to load user ${userId}: ${userErr.message}`);
  }
  if (!userRow) {
    throw new Error(`User ${userId} not found — seed via Supabase admin API.`);
  }

  const { data: repoRows, error: repoErr } = await supabase
    .from("user_repos")
    .select("repo_url, readme, manifest_json")
    .eq("user_id", userId);
  if (repoErr) {
    throw new Error(`Failed to load repos for ${userId}: ${repoErr.message}`);
  }

  return {
    profile_md: userRow.profile_md ?? "",
    repos: (repoRows ?? []).map(toRepoSnippet),
  };
}

function toRepoSnippet(row: {
  repo_url: string;
  readme: string | null;
  manifest_json: Json | null;
}): RepoSnippet {
  // manifest_json was stored by /repos as { files: { ... } }. Tolerate any
  // shape mismatch by falling back to an empty file map; a malformed row
  // shouldn't block scoring.
  const files: Partial<Record<string, string>> = {};
  if (
    row.manifest_json !== null &&
    typeof row.manifest_json === "object" &&
    !Array.isArray(row.manifest_json) &&
    "files" in row.manifest_json &&
    typeof row.manifest_json.files === "object" &&
    row.manifest_json.files !== null &&
    !Array.isArray(row.manifest_json.files)
  ) {
    const raw = row.manifest_json.files as Record<string, Json | undefined>;
    for (const [name, content] of Object.entries(raw)) {
      if (typeof content === "string") files[name] = content;
    }
  }
  return { url: row.repo_url, readme: row.readme, manifest: { files } };
}

async function loadUnscoredStories(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit: number,
): Promise<StoryToScore[]> {
  // Fetch unscored stories oldest-first so the queue eventually drains. We
  // join sources via a separate read to keep the SQL simple and avoid
  // PostgREST nested-select gotchas; it's a single small lookup per pass.
  // Step 1: get story IDs already scored for this user.
  const { data: scoredRows, error: scoredErr } = await supabase
    .from("story_scores")
    .select("story_id")
    .eq("user_id", userId);
  if (scoredErr) {
    throw new Error(`Failed to read story_scores: ${scoredErr.message}`);
  }
  const scoredIds = new Set((scoredRows ?? []).map((r) => r.story_id));

  // Step 2: fetch a window of stories oldest-first, then filter client-side.
  // For v1 scale (~200 stories/day) this is fine; if it grows we add a real
  // anti-join. Window size: limit * 4 to stay safe even when half are scored.
  const { data: storyRows, error: storyErr } = await supabase
    .from("stories")
    .select("id, source_id, title, body")
    .order("fetched_at", { ascending: true })
    .limit(limit * 4);
  if (storyErr) {
    throw new Error(`Failed to read stories: ${storyErr.message}`);
  }
  const candidates = (storyRows ?? []).filter((s) => !scoredIds.has(s.id));
  const window = candidates.slice(0, limit);
  if (window.length === 0) return [];

  // Step 3: resolve source names in one batch.
  const sourceIds = Array.from(new Set(window.map((s) => s.source_id)));
  const { data: sourceRows, error: sourceErr } = await supabase
    .from("sources")
    .select("id, name")
    .in("id", sourceIds);
  if (sourceErr) {
    throw new Error(`Failed to read sources: ${sourceErr.message}`);
  }
  const sourceNameById = new Map(
    (sourceRows ?? []).map((s) => [s.id, s.name]),
  );

  return window.map((s) => ({
    id: s.id,
    title: s.title,
    body: s.body,
    source_name: sourceNameById.get(s.source_id) ?? "unknown",
  }));
}

async function enqueue(
  supabase: SupabaseClient<Database>,
  storyId: string,
  userId: string,
  reason: string,
): Promise<void> {
  // upsert ignored — duplicate (story_id, user_id) means it's already queued.
  // The PK constraint will catch it; we swallow the error to avoid noisy logs.
  await supabase
    .from("scoring_retry_queue")
    .upsert(
      {
        story_id: storyId,
        user_id: userId,
        failure_reason: reason.slice(0, 1000),
      },
      { onConflict: "story_id,user_id" },
    );
}

function describeError(err: unknown): string {
  if (err instanceof ScoringValidationError) {
    return `validation: ${err.message}`;
  }
  if (err instanceof Anthropic.APIError) {
    return `anthropic ${err.status ?? "?"}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
