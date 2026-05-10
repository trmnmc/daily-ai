"use client";

import { FeedItemRow } from "./feed-item-row";
import type { FeedItemData } from "./feed-item";

/**
 * The feed: a vertical list of items separated by 1px hairline dividers.
 *
 * Each `<FeedItemRow>` wraps the presentational `<FeedItem>` plus its action
 * state (Try result panel, etc.). Rhythm comes from the `divide-y` between
 * row siblings — no per-card backgrounds, matches the Linear-style density.
 *
 * Infinite scroll (`react-intersection-observer`) is the v1.5 milestone after
 * the day's ingest fits in 50 rows. v1 ships with the simple `LIMIT 50` cap
 * and an empty-state message when scoring hasn't run yet.
 */

type FeedListProps = {
  items: FeedItemData[];
};

export function FeedList({ items }: FeedListProps) {
  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-base text-muted-foreground">
          Your feed is being personalized.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Check back after the next cron run (6 AM PT).
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <FeedItemRow key={item.id} item={item} />
      ))}
    </div>
  );
}
