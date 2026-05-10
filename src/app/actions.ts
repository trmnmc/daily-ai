"use server";

import { revalidatePath } from "next/cache";

import {
  generateTry,
  getTryDeps,
  TryRefusalError,
  type RepoSnippet,
  type TryArtifact,
  type TryDeps,
  type UserTryContext,
} from "@/lib/try-generation";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { V1_USER_ID } from "@/lib/v1-user";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server actions invoked from the feed (`/`) page.
 *
 * Day 5 #15: Try button click → call Sonnet 4.6 with story + user context →
 * persist artifact → return to caller for download/copy UI.
 *
 * v1 scope: just Try. Patch is Day 6 (Opus 4.7 + tool-use loop). Ignore is a
 * 1-row insert into card_actions and lands when the feed UI gets wired to
 * trigger it (also pending — needs cards on screen).
 *
 * NOTE: `loadUserContext` here is duplicated from `src/lib/scoring-runner.ts`.
 * Both will eventually pull from a shared `src/lib/user-context.ts`; deferred
 * to keep this tick bounded.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IgnoreStoryResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Insert a card_actions row with action='ignore' for the v1 user.
 *
 * Drives the Day 3 #12 ignore-weighting pass: the next scoring run (or any
 * re-scoring of an unscored story) will subtract 5 points per tag in this
 * story that's also in the user's last-100-ignores tag union, capped at 30.
 *
 * Idempotent at the unique-constraint level — there's no UNIQUE on
 * (user_id, story_id, action), so repeated clicks insert duplicate rows. v1
 * tolerates that (the recent-100 window absorbs duplicates) but a `distinct`
 * read in the runner keeps the math correct.
 */
export async function ignoreStory(
  storyId: string,
  opts: { supabase?: SupabaseClient<Database>; userId?: string } = {},
): Promise<IgnoreStoryResult> {
  if (!UUID_RE.test(storyId)) {
    return { ok: false, error: "Invalid story id." };
  }
  const supabase = opts.supabase ?? getSupabaseAdminClient();
  const userId = opts.userId ?? V1_USER_ID;

  const { error } = await supabase.from("card_actions").insert({
    user_id: userId,
    story_id: storyId,
    action: "ignore",
  });
  if (error) return { ok: false, error: error.message };

  // Future scoring runs will pick this up automatically. The rendered feed
  // doesn't need invalidation now — the row is still there, just user-flagged.
  // Once Day 3 #12.5 (hide ignored from feed) lands, this becomes
  // revalidatePath("/").
  revalidatePath("/");
  return { ok: true };
}

export type GenerateTryResult =
  | { ok: true; artifact: TryArtifact; artifactId: string }
  | { ok: false; error: string };

/**
 * Pre-charge per Try call. Sonnet 4.6 with cached profile+repos prefix
 * (~10K input cached) + per-call story body (~2K input) + ~3-5K output
 * lands around $0.05 actual. Pre-charging $0.10 leaves headroom for an
 * unusually large story body without overspending the daily cap. Pre-charge
 * is intentionally larger than scoring's $0.02 because Try output dwarfs
 * scoring output (single-file artifact vs. ~100-token JSON).
 */
const TRY_BUDGET_PER_CALL = 0.1;

/**
 * Generate a Try artifact for one story and persist it. Returns the artifact
 * inline so the caller can render the download link without a second round-trip.
 *
 * Dependency-injected for testability. In production, all defaults resolve.
 *
 * Cost gate: every LLM call goes through `try_charge_budget()` per design doc.
 * Returns a friendly "budget exhausted" error if the daily cap is hit — the
 * Patch action (Day 6) and the scoring cron will share the same ledger row.
 */
export async function generateTryForStory(
  storyId: string,
  opts: {
    supabase?: SupabaseClient<Database>;
    tryDeps?: TryDeps;
    userId?: string;
  } = {},
): Promise<GenerateTryResult> {
  if (!UUID_RE.test(storyId)) {
    return { ok: false, error: "Invalid story id." };
  }

  const supabase = opts.supabase ?? getSupabaseAdminClient();
  const userId = opts.userId ?? V1_USER_ID;

  // Load story.
  const { data: story, error: storyError } = await supabase
    .from("stories")
    .select("id, title, body, url")
    .eq("id", storyId)
    .maybeSingle();
  if (storyError) {
    return { ok: false, error: `Failed to load story: ${storyError.message}` };
  }
  if (!story) {
    return { ok: false, error: "Story not found." };
  }

  // Charge the budget BEFORE the LLM call. Race-safe via SELECT FOR UPDATE
  // inside the SQL function; two parallel Try clicks can't co-overspend.
  const { data: charged, error: chargeError } = await supabase.rpc(
    "try_charge_budget",
    { p_amount: TRY_BUDGET_PER_CALL },
  );
  if (chargeError) {
    return { ok: false, error: `Budget check failed: ${chargeError.message}` };
  }
  if (charged === false) {
    return {
      ok: false,
      error: "Daily LLM budget exhausted. Try again after midnight UTC.",
    };
  }

  // Load user context. (Duplicate of scoring-runner's loader — see file header.)
  let context: UserTryContext;
  try {
    context = await loadUserTryContext(supabase, userId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load user context.",
    };
  }

  // Generate.
  let artifact: TryArtifact;
  try {
    const tryDeps = opts.tryDeps ?? getTryDeps();
    artifact = await generateTry(tryDeps, context, {
      id: story.id,
      title: story.title,
      body: story.body,
      url: story.url,
    });
  } catch (err) {
    if (err instanceof TryRefusalError) {
      return {
        ok: false,
        error: "Couldn't generate a Try artifact for this story (refused).",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Generation failed.",
    };
  }

  // Persist.
  const { data: inserted, error: insertError } = await supabase
    .from("artifacts")
    .insert({
      user_id: userId,
      story_id: story.id,
      type: "try",
      content: artifact.content,
      run_command: artifact.run_command,
    })
    .select("id")
    .single();
  if (insertError) {
    // Generation succeeded but persistence failed — return the artifact anyway
    // so the user can still download it. Log the failure path in the result.
    return {
      ok: false,
      error: `Generated but couldn't save: ${insertError.message}`,
    };
  }

  return { ok: true, artifact, artifactId: inserted.id };
}

async function loadUserTryContext(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserTryContext> {
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
