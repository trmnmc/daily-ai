"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category, Resource } from "@/lib/osint-data";

/**
 * The OSINT console.
 *
 * State model:
 *   - target:        the string the operator is investigating (handle, IP, etc.)
 *   - selectedId:    which category's resources are shown in the center pane
 *   - log:           ring of recent operator actions (open/log/note), capped at 50
 *   - sessionId:     stable per page-load; for the "session 042" header chrome
 *   - clock:         wall-clock string, ticking once a second for the live feel
 *
 * The clock is the only thing that animates. Everything else is type and
 * 1px hairlines — matches the daily-ai aesthetic ("minimal as position,
 * not default"). The point of the live clock is to make this feel like a
 * live operator surface rather than a static directory of links — which is
 * what differentiates it from the underlying OSINT Framework site.
 */

type Props = {
  categories: Category[];
};

type LogEntry = {
  id: number;
  time: string;
  verb: "open" | "log" | "note" | "target";
  detail: string;
};

export function OsintConsole({ categories }: Props) {
  const [target, setTarget] = useState("");
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const [log, setLog] = useState<LogEntry[]>([]);
  // Clock + session ID derive from the wall clock. Lazy `useState`
  // initializers run once during the first render and are exempt from
  // the react-hooks/purity rule (which fires on values computed on every
  // render). Mounting with the real values avoids the placeholder flash.
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [sessionId] = useState(() =>
    (Math.floor(Date.now() / 1000) % 1000).toString().padStart(3, "0"),
  );

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  const selected = categories.find((c) => c.id === selectedId) ?? categories[0];

  function appendLog(verb: LogEntry["verb"], detail: string) {
    setLog((prev) => {
      const entry: LogEntry = {
        id: prev.length ? prev[0].id + 1 : 1,
        time: formatClock(new Date()),
        verb,
        detail,
      };
      // Newest first; cap at 50 so the pane scroll stays bounded.
      return [entry, ...prev].slice(0, 50);
    });
  }

  function onOpenResource(resource: Resource) {
    appendLog("open", `${resource.name}${target ? ` ← ${target}` : ""}`);
    window.open(resource.url, "_blank", "noopener,noreferrer");
  }

  function onLogLookup(resource: Resource) {
    const verb = resource.kind === "manual" ? "note" : "log";
    const detail = target
      ? `${resource.name} · ${target}`
      : `${resource.name} · (no target)`;
    appendLog(verb, detail);
  }

  function onCommitTarget() {
    const trimmed = target.trim();
    if (!trimmed) return;
    appendLog("target", trimmed);
  }

  return (
    <div className="flex min-h-[calc(100vh-3.625rem)] flex-1 flex-col">
      <ConsoleHeader
        target={target}
        onTargetChange={setTarget}
        onCommitTarget={onCommitTarget}
        sessionId={sessionId}
        clock={clock}
      />

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <CategoryRail
          categories={categories}
          selectedId={selected?.id ?? ""}
          onSelect={setSelectedId}
        />
        <ResourcePane
          category={selected}
          onOpenResource={onOpenResource}
          onLogLookup={onLogLookup}
        />
        <ActivityRail log={log} sessionId={sessionId} />
      </div>
    </div>
  );
}

/* ─── header ─────────────────────────────────────────────────────────── */

function ConsoleHeader({
  target,
  onTargetChange,
  onCommitTarget,
  sessionId,
  clock,
}: {
  target: string;
  onTargetChange: (v: string) => void;
  onCommitTarget: () => void;
  sessionId: string;
  clock: string;
}) {
  return (
    <div className="border-b border-border">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCommitTarget();
          }}
          className="flex flex-1 items-center gap-2"
        >
          <label
            htmlFor="osint-target"
            className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground"
          >
            target
          </label>
          <span aria-hidden className="font-mono text-primary">
            ▌
          </span>
          <input
            id="osint-target"
            type="text"
            value={target}
            onChange={(e) => onTargetChange(e.target.value)}
            placeholder="handle, email, domain, ip, sha256…"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="min-h-[2.25rem] flex-1 border-0 bg-transparent px-0 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:outline-none"
          />
        </form>

        <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-1.5 animate-pulse rounded-full bg-primary"
            />
            session {sessionId}
          </span>
          <span className="tabular-nums" aria-label={`Current UTC time ${clock}`}>
            {clock}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── left rail: categories ──────────────────────────────────────────── */

function CategoryRail({
  categories,
  selectedId,
  onSelect,
}: {
  categories: Category[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="border-b border-border lg:border-b-0 lg:border-r">
      <div className="sticky top-0 max-h-[calc(100vh-3.625rem-4.5rem)] overflow-y-auto py-2">
        <p className="px-4 pb-2 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground sm:px-6">
          categories
        </p>
        <ul className="flex flex-row gap-1 overflow-x-auto px-2 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0">
          {categories.map((cat) => {
            const active = cat.id === selectedId;
            return (
              <li key={cat.id} className="lg:w-full">
                <button
                  type="button"
                  onClick={() => onSelect(cat.id)}
                  aria-pressed={active}
                  className={cn(
                    "tap-target group relative flex w-full items-center justify-between gap-3 whitespace-nowrap px-3 py-2 text-left text-sm transition-colors lg:px-6",
                    "before:absolute before:left-0 before:top-1/2 before:hidden before:h-5 before:w-[2px] before:-translate-y-1/2 before:bg-transparent before:transition-colors lg:before:block",
                    active
                      ? "text-foreground before:bg-primary"
                      : "text-muted-foreground hover:text-foreground hover:before:bg-border",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{cat.name}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground/70 tabular-nums">
                    {cat.resources.length.toString().padStart(2, "0")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

/* ─── center pane: resources ─────────────────────────────────────────── */

function ResourcePane({
  category,
  onOpenResource,
  onLogLookup,
}: {
  category: Category | undefined;
  onOpenResource: (r: Resource) => void;
  onLogLookup: (r: Resource) => void;
}) {
  if (!category) return null;

  return (
    <section className="border-b border-border lg:border-b-0">
      <div className="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4 sm:px-6">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-medium tracking-tight text-foreground">
            {category.name}
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            takes {category.input}
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {category.resources.length} sources
        </span>
      </div>

      <ul className="divide-y divide-border">
        {category.resources.map((r) => (
          <ResourceRow
            key={r.id}
            resource={r}
            onOpen={() => onOpenResource(r)}
            onLog={() => onLogLookup(r)}
          />
        ))}
      </ul>
    </section>
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
    <li
      className={cn(
        "group/row relative grid grid-cols-1 items-start gap-3 px-4 py-4 transition-colors sm:grid-cols-[1fr_auto] sm:items-center sm:px-6",
        "before:absolute before:left-0 before:top-4 before:h-[calc(100%-2rem)] before:w-[2px] before:bg-transparent before:transition-colors hover:before:bg-primary",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <KindBadge kind={resource.kind} />
          <span className="text-base font-medium text-foreground">
            {resource.name}
          </span>
        </div>
        {resource.note && (
          <p className="mt-1 text-sm text-muted-foreground">{resource.note}</p>
        )}
        <p className="mt-1 font-mono text-xs text-muted-foreground/70">{host}</p>
      </div>

      <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={onLog}
          className="tap-target text-muted-foreground hover:text-foreground"
        >
          {isManual ? "note" : "log"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpen}
          className="tap-target border-primary bg-transparent text-primary hover:border-primary hover:bg-primary/10 hover:text-primary"
        >
          open ↗
        </Button>
      </div>
    </li>
  );
}

function KindBadge({ kind }: { kind: Resource["kind"] }) {
  const label = kind;
  const style =
    kind === "tool"
      ? "border-primary/40 text-primary"
      : kind === "manual"
        ? "border-destructive/40 text-destructive"
        : "border-border text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-[0.625rem] uppercase tracking-wider",
        style,
      )}
      aria-label={`Resource kind: ${label}`}
    >
      {label}
    </span>
  );
}

/* ─── right rail: activity ───────────────────────────────────────────── */

function ActivityRail({
  log,
  sessionId,
}: {
  log: LogEntry[];
  sessionId: string;
}) {
  return (
    <aside className="border-t border-border lg:border-l lg:border-t-0">
      <div className="sticky top-0 max-h-[calc(100vh-3.625rem-4.5rem)] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
            activity · session {sessionId}
          </p>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {log.length.toString().padStart(2, "0")}
          </span>
        </div>
        {log.length === 0 ? (
          <EmptyActivity />
        ) : (
          <ol className="divide-y divide-border" aria-live="polite">
            {log.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-3 px-4 py-2 sm:px-6"
              >
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {entry.time}
                </span>
                <VerbTag verb={entry.verb} />
                <span className="truncate text-sm text-foreground" title={entry.detail}>
                  {entry.detail}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
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

function EmptyActivity() {
  return (
    <div className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
      <p>No activity yet.</p>
      <p className="mt-1 text-xs">
        Set a target above, then <span className="font-mono">open</span> or{" "}
        <span className="font-mono">log</span> a source to start the trail.
      </p>
    </div>
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
