"use client";

import { useEffect, useState } from "react";

/**
 * <LastCronRun> badge — feed footer signal that the cron is alive.
 *
 * Reads the most recent successful sources.last_run_at and renders relative
 * time. Turns red if >24h. Closes the silent-cron-failure gap from the eng
 * review (Failure Mode Gap 1).
 *
 * In v1 takes lastRunAt as a prop (server component fetches it once during
 * the feed page render). v2 could subscribe to Postgres notifications for
 * live updates, but daily refresh is fine for v1.
 */

type LastCronRunProps = {
  /** ISO timestamp string, or null if no successful run yet. */
  lastRunAt: string | null;
};

export function LastCronRun({ lastRunAt }: LastCronRunProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const updateNow = () => setNowMs(Date.now());

    updateNow();
    const intervalId = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  if (!lastRunAt) {
    return (
      <p className="text-sm text-destructive">
        No cron runs yet. Check back after 6 AM PT, or trigger ingestion manually.
      </p>
    );
  }

  const last = new Date(lastRunAt);
  const ageMs = nowMs === null ? 0 : Math.max(0, nowMs - last.getTime());
  const ageHours = ageMs / 3_600_000;
  const stale = ageHours > 24;

  return (
    <p className={`text-sm ${stale ? "text-destructive" : "text-muted-foreground"}`}>
      Last update: {formatRelative(ageMs)}
    </p>
  );
}

function formatRelative(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
