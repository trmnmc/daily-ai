import { OsintDashboard } from "@/components/osint/dashboard";
import {
  OSINT_CATEGORIES,
  aggregateTelemetry,
  lookupTrend24h,
  worldActivityPings,
} from "@/lib/osint-data";

/**
 * /osint — OSINT operations dashboard.
 *
 * Dense ops-console style: top status bar, KPI strip, icon sidebar,
 * resource table with status pills + latency, world activity heatmap,
 * activity feed, source-health donut, top-tools rank.
 *
 * Server renders the static corpus + deterministic telemetry (so SSR
 * matches CSR). All interactivity (selected category, target input,
 * activity log) is handled inside <OsintDashboard>.
 */
export default function OsintPage() {
  const telemetry = aggregateTelemetry(OSINT_CATEGORIES);
  const trend = lookupTrend24h();
  const pings = worldActivityPings();

  return (
    <OsintDashboard
      categories={OSINT_CATEGORIES}
      telemetry={telemetry}
      trend={trend}
      pings={pings}
    />
  );
}
