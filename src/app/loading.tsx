import { TopNav } from "@/components/layout/top-nav";
import { FeedSkeleton } from "@/components/feed/feed-skeleton";

/**
 * Route-level loading boundary.
 *
 * Next.js renders this whenever a server component on this route is
 * suspended (e.g. waiting on a Supabase fetch). The user sees the same
 * top nav + a 5-item skeleton instead of a blank screen.
 *
 * Today this is mostly a stub since the feed page is rendering hardcoded
 * sample items. Once we wire Supabase reads on Day 4-5, this fires
 * automatically during navigation between feed states.
 */
export default function Loading() {
  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4">
        <FeedSkeleton count={5} />
      </main>
    </>
  );
}
