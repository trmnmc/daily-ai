"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CircleDot,
  Crosshair,
  ExternalLink,
  Filter,
  Gauge,
  Globe,
  Image as ImageIcon,
  Mail,
  MapPin,
  Network,
  Radar,
  Radio,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Skull,
  Terminal,
  User,
  Users,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  Category,
  CategoryIcon,
  Resource,
  ResourceStatus,
} from "@/lib/osint-data";

/* ────────────────────────────────────────────────────────────────────── *
 * <OsintDashboard>
 *
 * Top-rated-dashboard layout (header → KPI strip → sidebar+main+rail).
 * Dense, telemetry-forward, color-coded. Still dark + Geist + #CC7849
 * primary, but layered now: surfaces (`bg-card`/`bg-muted`), semantic
 * colors (success/warning/danger), and SVG charts (sparkline, donut,
 * world heat).
 * ────────────────────────────────────────────────────────────────────── */

type Telemetry = {
  sources: number;
  sourcesHealthy: number;
  sourcesDegraded: number;
  sourcesDown: number;
  totalReqs: number;
  avgLatency: number;
  successRate: number;
};

type Props = {
  categories: Category[];
  telemetry: Telemetry;
  trend: number[];
  pings: Array<{ x: number; y: number; weight: number }>;
};

type LogEntry = {
  id: number;
  time: string;
  verb: "open" | "log" | "note" | "target" | "alert";
  detail: string;
  status?: ResourceStatus;
};

type SortKey = "name" | "status" | "latency" | "uptime" | "reqs";

export function OsintDashboard({ categories, telemetry, trend, pings }: Props) {
  const [target, setTarget] = useState("");
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const [log, setLog] = useState<LogEntry[]>(() => seedLog(categories));
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [sessionId] = useState(() =>
    (Math.floor(Date.now() / 1000) % 1000).toString().padStart(3, "0"),
  );
  const [sortKey, setSortKey] = useState<SortKey>("reqs");
  const [statusFilter, setStatusFilter] = useState<ResourceStatus | "all">("all");

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  const selected = categories.find((c) => c.id === selectedId) ?? categories[0];

  // Top resources by 24h request count, across all categories. Powers the
  // "top tools" rail panel.
  const topResources = useMemo(() => {
    return [...categories.flatMap((c) => c.resources)]
      .sort((a, b) => b.reqs24h - a.reqs24h)
      .slice(0, 5);
  }, [categories]);

  function appendLog(
    verb: LogEntry["verb"],
    detail: string,
    status?: ResourceStatus,
  ) {
    setLog((prev) => {
      const entry: LogEntry = {
        id: prev.length ? prev[0].id + 1 : 1,
        time: formatClock(new Date()),
        verb,
        detail,
        status,
      };
      return [entry, ...prev].slice(0, 60);
    });
  }

  function onOpenResource(resource: Resource) {
    appendLog("open", `${resource.name}${target ? ` ← ${target}` : ""}`, resource.status);
    window.open(resource.url, "_blank", "noopener,noreferrer");
  }

  function onLogLookup(resource: Resource) {
    const verb = resource.kind === "manual" ? "note" : "log";
    const detail = target ? `${resource.name} · ${target}` : `${resource.name} · (no target)`;
    appendLog(verb, detail, resource.status);
  }

  function onCommitTarget() {
    const trimmed = target.trim();
    if (!trimmed) return;
    appendLog("target", trimmed);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DashboardHeader
        target={target}
        onTargetChange={setTarget}
        onCommitTarget={onCommitTarget}
        sessionId={sessionId}
        clock={clock}
        sourcesUp={telemetry.sourcesHealthy}
        sourcesTotal={telemetry.sources}
        sourcesDown={telemetry.sourcesDown}
      />

      <KpiStrip telemetry={telemetry} trend={trend} />

      <div className="grid grid-cols-1 gap-px bg-border xl:grid-cols-[224px_minmax(0,1fr)_340px]">
        <CategorySidebar
          categories={categories}
          selectedId={selected?.id ?? ""}
          onSelect={setSelectedId}
        />
        <MainColumn
          category={selected}
          pings={pings}
          sortKey={sortKey}
          onSortKeyChange={setSortKey}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onOpenResource={onOpenResource}
          onLogLookup={onLogLookup}
        />
        <RightRail
          log={log}
          topResources={topResources}
          telemetry={telemetry}
          trend={trend}
        />
      </div>

      <DashboardFooter telemetry={telemetry} sessionId={sessionId} />
    </div>
  );
}

/* ─── header ─────────────────────────────────────────────────────────── */

function DashboardHeader({
  target,
  onTargetChange,
  onCommitTarget,
  sessionId,
  clock,
  sourcesUp,
  sourcesTotal,
  sourcesDown,
}: {
  target: string;
  onTargetChange: (v: string) => void;
  onCommitTarget: () => void;
  sessionId: string;
  clock: string;
  sourcesUp: number;
  sourcesTotal: number;
  sourcesDown: number;
}) {
  const systemHealth = sourcesDown > 0 ? "warning" : "healthy";
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 font-medium tracking-tight">
          <span aria-hidden className="font-mono text-primary">
            ▌
          </span>
          <span>daily ai</span>
          <span className="text-muted-foreground/60">/</span>
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            osint ops
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCommitTarget();
          }}
          className="ml-auto flex flex-1 max-w-2xl items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 transition-colors focus-within:border-primary/60 focus-within:bg-muted/60"
        >
          <Crosshair className="size-3.5 text-primary" aria-hidden />
          <label htmlFor="osint-target" className="sr-only">
            Target
          </label>
          <input
            id="osint-target"
            type="text"
            value={target}
            onChange={(e) => onTargetChange(e.target.value)}
            placeholder="set target — handle, email, domain, ip, sha256, onion…"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="min-h-[2rem] flex-1 border-0 bg-transparent font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:outline-none"
          />
          {target && (
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground">
              ↵ commit
            </kbd>
          )}
        </form>

        <div className="hidden items-center gap-4 lg:flex">
          <SystemHealthChip
            status={systemHealth}
            up={sourcesUp}
            total={sourcesTotal}
          />
          <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <Radio className="size-3 text-primary" aria-hidden />
            session {sessionId}
          </div>
          <div
            className="font-mono text-xs tabular-nums text-muted-foreground"
            aria-label={`UTC ${clock}`}
          >
            {clock}
          </div>
        </div>
      </div>
    </header>
  );
}

function SystemHealthChip({
  status,
  up,
  total,
}: {
  status: "healthy" | "warning" | "critical";
  up: number;
  total: number;
}) {
  const color =
    status === "healthy"
      ? "text-emerald-400"
      : status === "warning"
        ? "text-amber-400"
        : "text-destructive";
  const dot =
    status === "healthy"
      ? "bg-emerald-400"
      : status === "warning"
        ? "bg-amber-400"
        : "bg-destructive";
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn("inline-block size-1.5 animate-pulse rounded-full", dot)}
        />
        <span className={cn("uppercase tracking-wider", color)}>
          {status === "healthy" ? "all systems" : status === "warning" ? "degraded" : "critical"}
        </span>
      </span>
      <span className="tabular-nums">
        {up}/{total}
      </span>
    </div>
  );
}

/* ─── KPI strip ──────────────────────────────────────────────────────── */

function KpiStrip({ telemetry, trend }: { telemetry: Telemetry; trend: number[] }) {
  return (
    <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-3 xl:grid-cols-5">
      <KpiTile
        icon={<Crosshair className="size-3.5" />}
        label="Active targets"
        value="847"
        delta="+12 / 24h"
        deltaTone="up"
        sparkline={trend}
      />
      <KpiTile
        icon={<Activity className="size-3.5" />}
        label="Lookups · 24h"
        value={formatCompact(telemetry.totalReqs)}
        delta="+8.2%"
        deltaTone="up"
        sparkline={trend.map((v, i) => v * (0.6 + (i / trend.length) * 0.6))}
      />
      <KpiTile
        icon={<CircleDot className="size-3.5" />}
        label="Sources online"
        value={`${telemetry.sourcesHealthy}/${telemetry.sources}`}
        delta={`${telemetry.sourcesDegraded} degraded · ${telemetry.sourcesDown} down`}
        deltaTone={telemetry.sourcesDown ? "down" : "neutral"}
        dots={{
          healthy: telemetry.sourcesHealthy,
          degraded: telemetry.sourcesDegraded,
          down: telemetry.sourcesDown,
        }}
      />
      <KpiTile
        icon={<Gauge className="size-3.5" />}
        label="Success rate"
        value={`${telemetry.successRate.toFixed(1)}%`}
        delta="SLO 99.0%"
        deltaTone={telemetry.successRate >= 99 ? "up" : "down"}
        ring={telemetry.successRate}
      />
      <KpiTile
        icon={<Zap className="size-3.5" />}
        label="Avg latency"
        value={`${telemetry.avgLatency}ms`}
        delta="p95 · 612ms"
        deltaTone="neutral"
        sparkline={trend.map((v) => 1 - v * 0.6)}
      />
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  delta,
  deltaTone,
  sparkline,
  dots,
  ring,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta: string;
  deltaTone: "up" | "down" | "neutral";
  sparkline?: number[];
  dots?: { healthy: number; degraded: number; down: number };
  ring?: number;
}) {
  const deltaColor =
    deltaTone === "up"
      ? "text-emerald-400"
      : deltaTone === "down"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="group relative flex flex-col gap-2 bg-card px-4 py-4 transition-colors hover:bg-muted/30 sm:px-5">
      <div className="flex items-center justify-between text-muted-foreground">
        <div className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.18em]">
          <span className="text-primary">{icon}</span>
          {label}
        </div>
        <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="font-medium tracking-tight tabular-nums text-foreground text-[1.625rem] leading-none">
          {value}
        </div>
        {sparkline && <Sparkline data={sparkline} />}
        {dots && <HealthDotStack {...dots} />}
        {typeof ring === "number" && <RingGauge value={ring} />}
      </div>

      <div className={cn("font-mono text-[0.6875rem] tracking-tight", deltaColor)}>
        {delta}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = 96;
  const h = 28;
  if (data.length === 0) return null;
  const max = Math.max(...data, 0.001);
  const min = Math.min(...data, 0);
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // Last bucket gets a dot for the "live" cursor.
  const lastX = w;
  const lastY = h - ((data[data.length - 1] - min) / (max - min || 1)) * h;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0 overflow-visible"
      aria-hidden
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#cc7849" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#cc7849" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#spark-fill)" />
      <polyline points={points} fill="none" stroke="#cc7849" strokeWidth="1.25" />
      <circle cx={lastX} cy={lastY} r="2" fill="#cc7849" />
    </svg>
  );
}

function HealthDotStack({
  healthy,
  degraded,
  down,
}: {
  healthy: number;
  degraded: number;
  down: number;
}) {
  const dots: { color: string }[] = [];
  for (let i = 0; i < healthy; i++) dots.push({ color: "bg-emerald-400" });
  for (let i = 0; i < degraded; i++) dots.push({ color: "bg-amber-400" });
  for (let i = 0; i < down; i++) dots.push({ color: "bg-destructive" });
  return (
    <div className="grid max-w-[120px] grid-cols-12 gap-0.5">
      {dots.map((d, i) => (
        <span key={i} className={cn("size-1.5 rounded-sm", d.color)} />
      ))}
    </div>
  );
}

function RingGauge({ value }: { value: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, value)) / 100) * c;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0" aria-hidden>
      <circle cx="22" cy="22" r={r} stroke="var(--border)" strokeWidth="3" fill="none" />
      <circle
        cx="22"
        cy="22"
        r={r}
        stroke="#cc7849"
        strokeWidth="3"
        fill="none"
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
      />
    </svg>
  );
}

/* ─── sidebar ────────────────────────────────────────────────────────── */

function CategorySidebar({
  categories,
  selectedId,
  onSelect,
}: {
  categories: Category[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="bg-background xl:row-span-1">
      <div className="flex items-center justify-between px-4 pb-2 pt-4 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
        <span>collections</span>
        <span className="tabular-nums">{categories.length}</span>
      </div>
      <nav>
        <ul className="flex flex-row gap-1 overflow-x-auto px-2 pb-2 xl:flex-col xl:gap-0 xl:overflow-visible xl:px-0">
          {categories.map((cat) => {
            const active = cat.id === selectedId;
            const counts = countByStatus(cat.resources);
            return (
              <li key={cat.id} className="xl:w-full">
                <button
                  type="button"
                  onClick={() => onSelect(cat.id)}
                  aria-pressed={active}
                  className={cn(
                    "tap-target group relative flex w-full items-center gap-3 whitespace-nowrap px-3 py-2 text-left text-sm transition-colors xl:px-4",
                    "before:absolute before:left-0 before:top-1/2 before:hidden before:h-5 before:w-[2px] before:-translate-y-1/2 before:bg-transparent before:transition-colors xl:before:block",
                    active
                      ? "bg-muted/50 text-foreground before:bg-primary"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                  )}
                >
                  <CategoryIconRender name={cat.icon} active={active} />
                  <span className="flex-1 truncate font-medium">{cat.name}</span>
                  <span className="hidden items-center gap-1 xl:flex">
                    {counts.down > 0 && (
                      <span
                        className="size-1.5 rounded-full bg-destructive"
                        aria-label={`${counts.down} down`}
                      />
                    )}
                    {counts.degraded > 0 && (
                      <span
                        className="size-1.5 rounded-full bg-amber-400"
                        aria-label={`${counts.degraded} degraded`}
                      />
                    )}
                  </span>
                  <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground/80">
                    {cat.resources.length.toString().padStart(2, "0")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="hidden border-t border-border px-4 py-3 xl:block">
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
          shortcuts
        </p>
        <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          <Shortcut keys="⌘ K" label="command palette" />
          <Shortcut keys="j / k" label="next / prev" />
          <Shortcut keys="o" label="open hovered" />
          <Shortcut keys="l" label="log lookup" />
        </ul>
      </div>
    </aside>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <kbd className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground">
        {keys}
      </kbd>
    </li>
  );
}

const ICONS: Record<CategoryIcon, React.ElementType> = {
  user: User,
  mail: Mail,
  globe: Globe,
  network: Network,
  image: ImageIcon,
  "map-pin": MapPin,
  users: Users,
  scale: Scale,
  spider: Skull,
  "shield-alert": ShieldAlert,
};

function CategoryIconRender({ name, active }: { name: CategoryIcon; active: boolean }) {
  const Icon = ICONS[name] ?? CircleDot;
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted/30 text-muted-foreground group-hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

function countByStatus(rs: Resource[]) {
  return rs.reduce(
    (acc, r) => {
      acc[r.status]++;
      return acc;
    },
    { healthy: 0, degraded: 0, down: 0 } as Record<ResourceStatus, number>,
  );
}

/* ─── main column ────────────────────────────────────────────────────── */

function MainColumn({
  category,
  pings,
  sortKey,
  onSortKeyChange,
  statusFilter,
  onStatusFilterChange,
  onOpenResource,
  onLogLookup,
}: {
  category: Category | undefined;
  pings: Array<{ x: number; y: number; weight: number }>;
  sortKey: SortKey;
  onSortKeyChange: (k: SortKey) => void;
  statusFilter: ResourceStatus | "all";
  onStatusFilterChange: (s: ResourceStatus | "all") => void;
  onOpenResource: (r: Resource) => void;
  onLogLookup: (r: Resource) => void;
}) {
  const filtered = useMemo(() => {
    if (!category) return [];
    const base =
      statusFilter === "all"
        ? category.resources
        : category.resources.filter((r) => r.status === statusFilter);
    return [...base].sort((a, b) => sortResources(a, b, sortKey));
  }, [category, sortKey, statusFilter]);

  if (!category) return null;

  return (
    <section className="flex min-w-0 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-medium tracking-tight">{category.name}</h1>
          <span className="font-mono text-xs text-muted-foreground">
            input: {category.input}
          </span>
          <span className="font-mono text-xs text-muted-foreground/70 tabular-nums">
            · {category.resources.length} sources
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusFilter value={statusFilter} onChange={onStatusFilterChange} />
          <Button
            variant="outline"
            size="sm"
            className="tap-target gap-1.5 border-border bg-transparent text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            tune
          </Button>
        </div>
      </div>

      <ResourceTable
        resources={filtered}
        sortKey={sortKey}
        onSortKeyChange={onSortKeyChange}
        onOpen={onOpenResource}
        onLog={onLogLookup}
      />

      <WorldHeatmap pings={pings} />
    </section>
  );
}

function StatusFilter({
  value,
  onChange,
}: {
  value: ResourceStatus | "all";
  onChange: (v: ResourceStatus | "all") => void;
}) {
  const opts: Array<{ id: ResourceStatus | "all"; label: string; dot?: string }> = [
    { id: "all", label: "all" },
    { id: "healthy", label: "healthy", dot: "bg-emerald-400" },
    { id: "degraded", label: "degraded", dot: "bg-amber-400" },
    { id: "down", label: "down", dot: "bg-destructive" },
  ];
  return (
    <div className="flex items-center gap-px overflow-hidden rounded-md border border-border bg-card">
      <Filter className="ml-2 size-3.5 text-muted-foreground" aria-hidden />
      {opts.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          aria-pressed={value === opt.id}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-wider transition-colors",
            value === opt.id
              ? "bg-muted/60 text-foreground"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
          )}
        >
          {opt.dot && <span className={cn("size-1.5 rounded-full", opt.dot)} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function sortResources(a: Resource, b: Resource, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "status": {
      const rank: Record<ResourceStatus, number> = { down: 0, degraded: 1, healthy: 2 };
      return rank[a.status] - rank[b.status];
    }
    case "latency":
      return (a.latencyMs || Infinity) - (b.latencyMs || Infinity);
    case "uptime":
      return b.uptimePct - a.uptimePct;
    case "reqs":
    default:
      return b.reqs24h - a.reqs24h;
  }
}

/* ─── resource table ─────────────────────────────────────────────────── */

function ResourceTable({
  resources,
  sortKey,
  onSortKeyChange,
  onOpen,
  onLog,
}: {
  resources: Resource[];
  sortKey: SortKey;
  onSortKeyChange: (k: SortKey) => void;
  onOpen: (r: Resource) => void;
  onLog: (r: Resource) => void;
}) {
  return (
    <div className="overflow-x-auto border-y border-border">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="bg-muted/30 text-left font-mono text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground">
            <ColHeader label="source" k="name" sortKey={sortKey} onClick={onSortKeyChange} />
            <ColHeader label="status" k="status" sortKey={sortKey} onClick={onSortKeyChange} align="left" />
            <ColHeader label="latency" k="latency" sortKey={sortKey} onClick={onSortKeyChange} align="right" />
            <ColHeader label="uptime · 24h" k="uptime" sortKey={sortKey} onClick={onSortKeyChange} align="right" />
            <ColHeader label="reqs · 24h" k="reqs" sortKey={sortKey} onClick={onSortKeyChange} align="right" />
            <th className="px-3 py-2 text-right">actions</th>
          </tr>
        </thead>
        <tbody>
          {resources.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                No sources match this filter.
              </td>
            </tr>
          )}
          {resources.map((r) => (
            <ResourceRow key={r.id} resource={r} onOpen={() => onOpen(r)} onLog={() => onLog(r)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColHeader({
  label,
  k,
  sortKey,
  onClick,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <th className={cn("px-3 py-2", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        {active && <span aria-hidden>▾</span>}
      </button>
    </th>
  );
}

function ResourceRow({
  resource,
  onOpen,
  onLog,
}: {
  resource: Resource;
  onOpen: () => void;
  onLog: () => void;
}) {
  const isManual = resource.kind === "manual";
  const host = useMemo(() => safeHost(resource.url), [resource.url]);

  return (
    <tr
      className={cn(
        "group/row relative border-t border-border/60 transition-colors hover:bg-muted/30",
      )}
    >
      <td className="px-3 py-3">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5">
            <StatusDot status={resource.status} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{resource.name}</span>
              <KindBadge kind={resource.kind} />
            </div>
            {resource.note && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{resource.note}</p>
            )}
            <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground/70">{host}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 align-middle">
        <StatusPill status={resource.status} />
      </td>
      <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
        {resource.latencyMs > 0 ? (
          <span
            className={cn(
              resource.latencyMs > 500
                ? "text-amber-400"
                : resource.latencyMs > 200
                  ? "text-foreground"
                  : "text-emerald-400",
            )}
          >
            {resource.latencyMs}ms
          </span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
        <UptimeBar value={resource.uptimePct} />
      </td>
      <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums text-muted-foreground">
        {resource.reqs24h > 0 ? formatCompact(resource.reqs24h) : "—"}
      </td>
      <td className="px-3 py-3 text-right align-middle">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={onLog}
            className="text-muted-foreground hover:text-foreground"
          >
            {isManual ? "note" : "log"}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={onOpen}
            className="gap-1 border-primary/50 bg-transparent text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
          >
            open
            <ExternalLink className="size-3" aria-hidden />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function StatusDot({ status }: { status: ResourceStatus }) {
  const color =
    status === "healthy"
      ? "bg-emerald-400"
      : status === "degraded"
        ? "bg-amber-400"
        : "bg-destructive";
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        color,
        status !== "down" && "shadow-[0_0_6px_currentColor]",
      )}
      style={
        status === "healthy"
          ? { color: "#34d399" }
          : status === "degraded"
            ? { color: "#fbbf24" }
            : undefined
      }
    />
  );
}

function StatusPill({ status }: { status: ResourceStatus }) {
  const style =
    status === "healthy"
      ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-400"
      : status === "degraded"
        ? "border-amber-400/30 bg-amber-400/5 text-amber-400"
        : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider",
        style,
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {status}
    </span>
  );
}

function KindBadge({ kind }: { kind: Resource["kind"] }) {
  const style =
    kind === "tool"
      ? "border-primary/40 text-primary"
      : kind === "manual"
        ? "border-destructive/40 text-destructive"
        : "border-border text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-[0.5625rem] uppercase tracking-wider",
        style,
      )}
    >
      {kind}
    </span>
  );
}

function UptimeBar({ value }: { value: number }) {
  // Render as 24 cells (24h). Each cell ~99.5%+ is green, 95-99.5% amber, <95% red.
  // Without real per-hour data we color the whole bar with the rolled-up grade
  // and show the value as a number for precision.
  const grade =
    value >= 99.5 ? "bg-emerald-400" : value >= 95 ? "bg-amber-400" : "bg-destructive";
  const cells = 24;
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={cn(
          value >= 99.5
            ? "text-emerald-400"
            : value >= 95
              ? "text-amber-400"
              : "text-destructive",
        )}
      >
        {value.toFixed(1)}%
      </span>
      <span aria-hidden className="hidden gap-[1px] sm:inline-flex">
        {Array.from({ length: cells }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-3 w-[3px] rounded-sm opacity-80",
              // Distribute "bad" cells based on grade gap to suggest some hours were worse.
              i < Math.round((1 - value / 100) * cells * 1.5) ? "bg-border" : grade,
            )}
          />
        ))}
      </span>
    </div>
  );
}

/* ─── world heat map ─────────────────────────────────────────────────── */

function WorldHeatmap({
  pings,
}: {
  pings: Array<{ x: number; y: number; weight: number }>;
}) {
  // 80-col × 32-row dot grid with stylized continent silhouettes. Dot
  // brightness = sin(continent membership). Ping markers overlay on top.
  const cols = 80;
  const rows = 32;
  const cellW = 8;
  const cellH = 8;
  const w = cols * cellW;
  const h = rows * cellH;

  return (
    <div className="border-b border-border bg-card">
      <div className="flex items-center justify-between px-4 pb-2 pt-4 sm:px-6">
        <div className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
          <Radar className="size-3.5 text-primary" aria-hidden />
          live activity heatmap · 24h
        </div>
        <div className="flex items-center gap-3 font-mono text-[0.625rem] uppercase tracking-wider text-muted-foreground">
          <LegendDot color="bg-emerald-400" label="low" />
          <LegendDot color="bg-amber-400" label="med" />
          <LegendDot color="bg-primary" label="high" />
        </div>
      </div>
      <div className="overflow-x-auto px-4 pb-4 sm:px-6">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-auto w-full max-w-[820px]"
          aria-label="World activity heatmap"
          role="img"
        >
          {/* base dot grid */}
          {Array.from({ length: rows }).map((_, ry) =>
            Array.from({ length: cols }).map((_, cx) => {
              const cont = isContinent(cx / cols, ry / rows);
              return (
                <circle
                  key={`${cx}-${ry}`}
                  cx={cx * cellW + cellW / 2}
                  cy={ry * cellH + cellH / 2}
                  r={cont ? 1.2 : 0.7}
                  fill={cont ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}
                />
              );
            }),
          )}
          {/* pings */}
          {pings.map((p, i) => {
            const cx = p.x * w;
            const cy = p.y * h;
            const r = 4 + p.weight * 4;
            const color = p.weight > 0.85 ? "#cc7849" : p.weight > 0.65 ? "#fbbf24" : "#34d399";
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r * 2.5} fill={color} opacity={0.08} />
                <circle cx={cx} cy={cy} r={r * 1.6} fill={color} opacity={0.18} />
                <circle cx={cx} cy={cy} r={r} fill={color}>
                  <animate
                    attributeName="r"
                    values={`${r};${r * 1.4};${r}`}
                    dur={`${2.5 + (i % 5) * 0.4}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}

/** Hand-tuned continent membership for the dot grid. Coords in [0,1]. */
function isContinent(x: number, y: number): boolean {
  // North America
  if (x > 0.10 && x < 0.32 && y > 0.30 && y < 0.55) return true;
  // South America
  if (x > 0.26 && x < 0.36 && y > 0.55 && y < 0.78) return true;
  // Europe
  if (x > 0.44 && x < 0.55 && y > 0.30 && y < 0.45) return true;
  // Africa
  if (x > 0.46 && x < 0.58 && y > 0.45 && y < 0.72) return true;
  // Middle East / Russia
  if (x > 0.52 && x < 0.70 && y > 0.32 && y < 0.50) return true;
  // Asia
  if (x > 0.65 && x < 0.86 && y > 0.32 && y < 0.55) return true;
  // SE Asia / India
  if (x > 0.66 && x < 0.82 && y > 0.50 && y < 0.62) return true;
  // Australia
  if (x > 0.80 && x < 0.92 && y > 0.65 && y < 0.78) return true;
  return false;
}

/* ─── right rail ─────────────────────────────────────────────────────── */

function RightRail({
  log,
  topResources,
  telemetry,
  trend,
}: {
  log: LogEntry[];
  topResources: Resource[];
  telemetry: Telemetry;
  trend: number[];
}) {
  return (
    <aside className="flex flex-col gap-px bg-border">
      <ActivityFeed log={log} />
      <SourceHealthPanel telemetry={telemetry} />
      <TopToolsPanel resources={topResources} />
      <TrendPanel trend={trend} totalReqs={telemetry.totalReqs} />
    </aside>
  );
}

function PanelHeader({
  icon,
  label,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-3 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="text-primary">{icon}</span>
        {label}
      </span>
      {trailing}
    </div>
  );
}

function ActivityFeed({ log }: { log: LogEntry[] }) {
  return (
    <section className="bg-background">
      <PanelHeader
        icon={<Terminal className="size-3.5" />}
        label="activity feed"
        trailing={
          <span className="font-mono text-xs tabular-nums">
            {log.length.toString().padStart(2, "0")}
          </span>
        }
      />
      {log.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          <p>No activity yet.</p>
          <p className="mt-1 text-xs">
            Set a target above, then <span className="font-mono">open</span> or{" "}
            <span className="font-mono">log</span> a source.
          </p>
        </div>
      ) : (
        <ol
          className="max-h-[18rem] overflow-y-auto divide-y divide-border/60 border-t border-border"
          aria-live="polite"
        >
          {log.map((entry) => (
            <li
              key={entry.id}
              className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3 px-4 py-2"
            >
              <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
                {entry.time}
              </span>
              <VerbTag verb={entry.verb} />
              <span
                className="truncate text-xs text-foreground"
                title={entry.detail}
              >
                {entry.detail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function VerbTag({ verb }: { verb: LogEntry["verb"] }) {
  const style =
    verb === "target"
      ? "text-primary"
      : verb === "open"
        ? "text-foreground"
        : verb === "note"
          ? "text-destructive"
          : verb === "alert"
            ? "text-amber-400"
            : "text-muted-foreground";
  return (
    <span
      className={cn(
        "font-mono text-[0.625rem] uppercase tracking-wider",
        style,
      )}
    >
      {verb}
    </span>
  );
}

function SourceHealthPanel({ telemetry }: { telemetry: Telemetry }) {
  const total = telemetry.sources;
  return (
    <section className="bg-background">
      <PanelHeader icon={<CircleDot className="size-3.5" />} label="source health" />
      <div className="flex items-center gap-4 px-4 pb-4">
        <DonutChart
          segments={[
            { value: telemetry.sourcesHealthy, color: "#34d399" },
            { value: telemetry.sourcesDegraded, color: "#fbbf24" },
            { value: telemetry.sourcesDown, color: "#e5484d" },
          ]}
          center={
            <div className="flex flex-col items-center">
              <span className="font-mono text-base tabular-nums leading-none text-foreground">
                {telemetry.sourcesHealthy}
              </span>
              <span className="mt-0.5 font-mono text-[0.5625rem] uppercase tracking-wider text-muted-foreground">
                up / {total}
              </span>
            </div>
          }
        />
        <ul className="flex-1 space-y-1.5 text-xs">
          <HealthLegend color="bg-emerald-400" label="healthy" value={telemetry.sourcesHealthy} total={total} />
          <HealthLegend color="bg-amber-400" label="degraded" value={telemetry.sourcesDegraded} total={total} />
          <HealthLegend color="bg-destructive" label="down" value={telemetry.sourcesDown} total={total} />
        </ul>
      </div>
    </section>
  );
}

function HealthLegend({
  color,
  label,
  value,
  total,
}: {
  color: string;
  label: string;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <li className="flex items-center gap-2">
      <span className={cn("size-1.5 rounded-full", color)} />
      <span className="flex-1 capitalize text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
      <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground/70">
        {pct.toFixed(0)}%
      </span>
    </li>
  );
}

function DonutChart({
  segments,
  center,
}: {
  segments: Array<{ value: number; color: string }>;
  center?: React.ReactNode;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const r = 32;
  const stroke = 8;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
        <circle cx="42" cy="42" r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        {total > 0 &&
          segments.map((s, i) => {
            const len = (s.value / total) * c;
            const seg = (
              <circle
                key={i}
                cx="42"
                cy="42"
                r={r}
                stroke={s.color}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 42 42)"
                strokeLinecap="butt"
              />
            );
            offset += len;
            return seg;
          })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex items-center justify-center">{center}</div>
      )}
    </div>
  );
}

function TopToolsPanel({ resources }: { resources: Resource[] }) {
  const max = resources[0]?.reqs24h ?? 1;
  return (
    <section className="bg-background">
      <PanelHeader icon={<ArrowUpRight className="size-3.5" />} label="top sources · 24h" />
      <ol className="px-4 pb-4">
        {resources.map((r, i) => {
          const pct = (r.reqs24h / max) * 100;
          return (
            <li key={r.id} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 py-1.5">
              <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs text-foreground">{r.name}</div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full bg-primary/80"
                    style={{ width: `${pct.toFixed(1)}%` }}
                  />
                </div>
              </div>
              <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
                {formatCompact(r.reqs24h)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TrendPanel({ trend, totalReqs }: { trend: number[]; totalReqs: number }) {
  // Bar version of the sparkline — more dashboard-y than the strip line.
  const max = Math.max(...trend, 0.001);
  return (
    <section className="bg-background">
      <PanelHeader
        icon={<Activity className="size-3.5" />}
        label="lookups · per hour"
        trailing={
          <span className="font-mono text-xs tabular-nums text-foreground">
            Σ {formatCompact(totalReqs)}
          </span>
        }
      />
      <div className="flex h-20 items-end gap-[3px] px-4">
        {trend.map((v, i) => {
          const h = (v / max) * 100;
          return (
            <span
              key={i}
              className={cn(
                "block flex-1 rounded-sm",
                i === trend.length - 1 ? "bg-primary" : "bg-primary/40",
              )}
              style={{ height: `${Math.max(6, h)}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between px-4 pb-3 pt-1 font-mono text-[0.5625rem] uppercase tracking-wider text-muted-foreground">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>now</span>
      </div>
    </section>
  );
}

/* ─── footer ─────────────────────────────────────────────────────────── */

function DashboardFooter({
  telemetry,
  sessionId,
}: {
  telemetry: Telemetry;
  sessionId: string;
}) {
  return (
    <footer className="border-t border-border bg-background/80">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 font-mono text-[0.625rem] uppercase tracking-wider text-muted-foreground sm:px-6">
        <span className="flex items-center gap-2">
          <CircleDot className="size-3 text-emerald-400" aria-hidden />
          osint-ops · session {sessionId}
        </span>
        <span className="flex items-center gap-4">
          <span>build · v0.1.0</span>
          <span>region · iad1</span>
          <span>
            sources · {telemetry.sources} ({telemetry.sourcesHealthy} up)
          </span>
        </span>
      </div>
    </footer>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function formatClock(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

/**
 * Seed the activity log with a few entries so the panel doesn't open empty —
 * dashboards live or die on whether their "live" surfaces look populated.
 * Times are computed from "now" so they read as plausibly recent.
 */
function seedLog(categories: Category[]): LogEntry[] {
  const now = new Date();
  const minusMin = (m: number) => {
    const d = new Date(now.getTime() - m * 60_000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  };
  const down = categories.flatMap((c) => c.resources).find((r) => r.status === "down");
  const degraded = categories.flatMap((c) => c.resources).find((r) => r.status === "degraded");
  const entries: LogEntry[] = [
    { id: 6, time: minusMin(0), verb: "target", detail: "blocktorrent.example.com" },
    { id: 5, time: minusMin(1), verb: "open", detail: "Shodan ← blocktorrent.example.com" },
    { id: 4, time: minusMin(2), verb: "log", detail: "VirusTotal · 3f9c…ab12 (hash)" },
    { id: 3, time: minusMin(4), verb: "open", detail: "DNSDumpster ← blocktorrent.example.com" },
  ];
  if (degraded) {
    entries.push({
      id: 2,
      time: minusMin(7),
      verb: "alert",
      detail: `${degraded.name} latency ${degraded.latencyMs}ms (>p95)`,
      status: degraded.status,
    });
  }
  if (down) {
    entries.push({
      id: 1,
      time: minusMin(12),
      verb: "alert",
      detail: `${down.name} probe failed — last seen 18m ago`,
      status: down.status,
    });
  }
  return entries.sort((a, b) => b.id - a.id);
}
