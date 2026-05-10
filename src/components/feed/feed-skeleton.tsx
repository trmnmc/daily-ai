import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton placeholder for the feed.
 *
 * Each skeleton item mirrors the FeedItem shape so the layout doesn't shift
 * when real content lands:
 *   - source dot + name + timestamp row
 *   - "why I care" line (24px, 2 rows worth of width)
 *   - title line (smaller)
 *   - 3-button row right-aligned
 *
 * Renders 5 placeholders by default — matches the design's "5 items per
 * viewport at 1080p" target so the visible loading state isn't punier than
 * the loaded state. Don't render fewer; the visual pop on load is the point.
 *
 * Used by:
 *   - <Suspense fallback={<FeedSkeleton />}> wrapping the real feed
 *   - app/loading.tsx (route-level Next.js loading boundary)
 *   - /?state=loading query param (manual preview during development)
 */

type FeedSkeletonProps = {
  count?: number;
};

export function FeedSkeleton({ count = 5 }: FeedSkeletonProps) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading feed&hellip;</span>
      {Array.from({ length: count }).map((_, i) => (
        <FeedSkeletonItem key={i} />
      ))}
    </div>
  );
}

function FeedSkeletonItem() {
  return (
    <div className="flex flex-col gap-3 py-5 pl-4">
      {/* Source row: dot + name + timestamp */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-1.5 w-1.5 rounded-full" />
        <Skeleton className="h-3 w-32" />
      </div>

      {/* Why I care — two lines worth of skeleton at 24px height */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-4/5" />
      </div>

      {/* Title — single line, ~70% width */}
      <Skeleton className="h-3.5 w-3/4" />

      {/* Action button row — right aligned */}
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
        <Skeleton className="h-9 w-full rounded-md sm:w-16" />
        <Skeleton className="h-9 w-full rounded-md sm:w-14" />
        <Skeleton className="h-9 w-full rounded-md sm:w-16" />
      </div>
    </div>
  );
}
