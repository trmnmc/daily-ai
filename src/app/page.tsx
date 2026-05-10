import { TopNav } from "@/components/layout/top-nav";
import { LastCronRun } from "@/components/layout/last-cron-run";
import { FeedList } from "@/components/feed/feed-list";
import { loadFeedItems, loadLastCronRunAt } from "@/lib/feed";
import { V1_USER_ID } from "@/lib/v1-user";

/**
 * The feed page (/).
 *
 * Server-renders the user's scored feed: `story_scores JOIN stories` for
 * V1_USER_ID where score >= 60, ordered desc. Until scoring has run at
 * least once (or all scores are < 60), <FeedList items={[]}> renders the
 * "Your feed is being personalized" empty state.
 *
 * The Day 1 design-preview toggles (`?state=loading|empty`) were retired
 * with this rewrite — the loading state now triggers naturally via
 * `app/loading.tsx` while the DB queries resolve.
 *
 * Onboarding-gate redirect (when profile_md < 50 chars) lives in Day 7 with
 * the rest of auth — for v1 we render unconditionally and let the empty
 * feed nudge the user toward `/profile`.
 */
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  // Run reads in parallel — they're independent and cheap individually.
  const [items, lastRunAt] = await Promise.all([
    loadFeedItems(V1_USER_ID),
    loadLastCronRunAt(),
  ]);

  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4">
        <FeedList items={items} />
      </main>
      <footer className="mx-auto w-full max-w-[720px] px-4 py-8">
        <LastCronRun lastRunAt={lastRunAt} />
      </footer>
    </>
  );
}
