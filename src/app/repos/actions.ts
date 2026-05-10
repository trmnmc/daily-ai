"use server";

import { revalidatePath } from "next/cache";

import {
  fetchPublicRepo,
  parseGithubUrl,
  RepoFetchError,
} from "@/lib/github";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { V1_USER_ID } from "@/lib/v1-user";

/**
 * Server actions for the /repos page.
 *
 * v1 scope: add / remove / refresh a public GitHub repo (max 5). PAT support
 * for private repos is the remaining carry-over (gated on ENCRYPTION_KEY).
 */
const MAX_REPOS = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AddRepoResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function addRepo(
  _previous: AddRepoResult | null,
  formData: FormData,
): Promise<AddRepoResult> {
  const raw = formData.get("repo_url");
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Paste a GitHub repo URL." };
  }

  const parsed = parseGithubUrl(raw);
  if (!parsed) {
    return {
      ok: false,
      error: "That doesn't look like a github.com URL. Try owner/repo or a full URL.",
    };
  }

  const supabase = getSupabaseAdminClient();

  // Cap enforcement (race-safe enough for v1 single-user; real concurrency
  // protection would need a unique partial index or a stored procedure).
  const { count, error: countError } = await supabase
    .from("user_repos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", V1_USER_ID);
  if (countError) return { ok: false, error: countError.message };
  if ((count ?? 0) >= MAX_REPOS) {
    return {
      ok: false,
      error: `You already have ${MAX_REPOS} repos. Remove one to add another.`,
    };
  }

  // Duplicate check (the unique constraint would catch this, but a friendly
  // error beats a Postgres error string in the toast).
  const { data: existing, error: dupError } = await supabase
    .from("user_repos")
    .select("id")
    .eq("user_id", V1_USER_ID)
    .eq("repo_url", parsed.url)
    .maybeSingle();
  if (dupError) return { ok: false, error: dupError.message };
  if (existing) return { ok: false, error: "That repo is already on your list." };

  // Fetch metadata. RepoFetchError carries a user-facing message; anything
  // else is unexpected and we surface the raw message.
  let fetched;
  try {
    fetched = await fetchPublicRepo(parsed);
  } catch (err) {
    if (err instanceof RepoFetchError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to fetch repo.",
    };
  }

  const { error: insertError } = await supabase.from("user_repos").insert({
    user_id: V1_USER_ID,
    repo_url: fetched.url,
    readme: fetched.readme,
    manifest_json: fetched.manifest,
  });
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath("/repos");
  return { ok: true, url: fetched.url };
}

export type RemoveRepoResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Remove a single repo. Scoped to V1_USER_ID via the WHERE clause — even if
 * a tampered formData carries someone else's repo id, the delete won't match.
 * (Belt and suspenders: RLS will enforce this once auth ships in Day 7.)
 */
export async function removeRepo(
  _previous: RemoveRepoResult | null,
  formData: FormData,
): Promise<RemoveRepoResult> {
  const id = formData.get("id");
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return { ok: false, error: "Invalid repo id." };
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("user_repos")
    .delete()
    .eq("id", id)
    .eq("user_id", V1_USER_ID)
    .select("repo_url")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) {
    // Either someone else's repo (filter eliminated it) or a stale id.
    return { ok: false, error: "Repo not found — refresh the page." };
  }

  revalidatePath("/repos");
  return { ok: true, url: data.repo_url };
}

export type RefreshRepoResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Re-fetch a repo's README + manifest from GitHub and overwrite the stored
 * snapshot. Idempotent. Same `WHERE user_id` scoping as remove.
 */
export async function refreshRepo(
  _previous: RefreshRepoResult | null,
  formData: FormData,
): Promise<RefreshRepoResult> {
  const id = formData.get("id");
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return { ok: false, error: "Invalid repo id." };
  }

  const supabase = getSupabaseAdminClient();
  const { data: existing, error: loadError } = await supabase
    .from("user_repos")
    .select("repo_url")
    .eq("id", id)
    .eq("user_id", V1_USER_ID)
    .maybeSingle();
  if (loadError) return { ok: false, error: loadError.message };
  if (!existing) return { ok: false, error: "Repo not found." };

  const parsed = parseGithubUrl(existing.repo_url);
  if (!parsed) {
    // Should be impossible — we validated on insert — but treat defensively.
    return { ok: false, error: `Stored URL is unparseable: ${existing.repo_url}` };
  }

  let fetched;
  try {
    fetched = await fetchPublicRepo(parsed);
  } catch (err) {
    if (err instanceof RepoFetchError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to refresh.",
    };
  }

  const { error: updateError } = await supabase
    .from("user_repos")
    .update({
      readme: fetched.readme,
      manifest_json: fetched.manifest,
      fetched_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", V1_USER_ID);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/repos");
  return { ok: true, url: fetched.url };
}
