import { TopNav } from "@/components/layout/top-nav";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { V1_USER_ID } from "@/lib/v1-user";

import { RepoForm } from "./repo-form";
import { RepoRowActions } from "./repo-row-actions";

/**
 * /repos — pasted GitHub repo URL list (max 5 in v1).
 *
 * Day 3 sub-item #2 (this tick): list + add. Each row's README + manifest
 * feeds the Sonnet scoring prompt. Refresh / Remove actions and PAT support
 * land in follow-up ticks (PAT requires the ENCRYPTION_KEY env var).
 */
export const dynamic = "force-dynamic";

const MAX_REPOS = 5;

/**
 * Server-side relative time. Stable across server renders within the same
 * request (no client tick — repos are added rarely enough that "5 min ago"
 * staleness is fine until the next page load).
 */
function fetchedAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function ReposPage() {
  const supabase = getSupabaseAdminClient();
  const { data: repos, error } = await supabase
    .from("user_repos")
    .select("id, repo_url, fetched_at")
    .eq("user_id", V1_USER_ID)
    .order("fetched_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load repos: ${error.message}`);
  }

  const remaining = MAX_REPOS - (repos?.length ?? 0);

  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-8">
        <h1 className="mb-2 text-2xl font-medium tracking-tight">Repos</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Add up to 5 public GitHub repos. daily ai reads each repo&apos;s README and manifest files (package.json, requirements.txt, pyproject.toml) to tailor diffs to your code.
        </p>

        {!repos || repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a repo to enable Patch.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {repos.map((repo) => (
              <div
                key={repo.id}
                className="flex items-center justify-between py-4"
              >
                <div className="flex flex-col gap-1">
                  <a
                    href={repo.repo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm hover:text-primary"
                  >
                    {repo.repo_url.replace("https://github.com/", "")}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    Fetched {fetchedAgo(repo.fetched_at)}
                  </span>
                </div>
                <RepoRowActions repoId={repo.id} repoUrl={repo.repo_url} />
              </div>
            ))}
          </div>
        )}

        {remaining > 0 ? (
          <RepoForm />
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">
            You&apos;ve hit the {MAX_REPOS}-repo cap. Remove one to add another (coming soon).
          </p>
        )}
      </main>
    </>
  );
}
