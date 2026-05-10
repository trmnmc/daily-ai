"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  generateTryForStory,
  ignoreStory,
  type GenerateTryResult,
} from "@/app/actions";

import { FeedItem, type FeedItemData } from "./feed-item";

/**
 * Stateful wrapper around <FeedItem>.
 *
 * Owns the per-row Try-action state: invoke the server action on click, hold
 * the result, render an inline result panel below the item with a Download
 * button + copy-run-command. The base <FeedItem> stays presentational —
 * adding action state directly to it would couple every test of that
 * component to a server-action mock.
 *
 * Ignore and Patch are still stubs:
 *   - Ignore: needs `card_actions` insert + ignore-weighting (Day 3 #12).
 *   - Patch: Day 6, Opus 4.7 + tool-use loop, separate LLM module pending.
 */

type Props = {
  item: FeedItemData;
};

type LocalTryState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "result"; result: GenerateTryResult };

export function FeedItemRow({ item }: Props) {
  const [state, setState] = useState<LocalTryState>({ kind: "idle" });
  const [, startTransition] = useTransition();

  function onTry() {
    setState({ kind: "pending" });
    startTransition(async () => {
      const result = await generateTryForStory(item.id);
      setState({ kind: "result", result });
      if (!result.ok) {
        toast.error("Try generation failed", { description: result.error });
      }
    });
  }

  function onIgnore() {
    startTransition(async () => {
      const result = await ignoreStory(item.id);
      if (result.ok) {
        toast.success("Ignored", {
          description: "Future similar stories will be down-ranked.",
        });
      } else {
        toast.error("Couldn't ignore", { description: result.error });
      }
    });
  }

  function onPatch() {
    // Stub — Day 6.
    toast.info("Patch", { description: "Day 6 — Opus 4.7 + tool-use loop." });
  }

  return (
    <div>
      <FeedItem
        item={item}
        onIgnore={onIgnore}
        onTry={onTry}
        onPatch={onPatch}
      />
      {state.kind !== "idle" && (
        <TryResultPanel
          state={state}
          onDismiss={() => setState({ kind: "idle" })}
          onRetry={onTry}
        />
      )}
    </div>
  );
}

type PanelProps = {
  state: Exclude<LocalTryState, { kind: "idle" }>;
  onDismiss: () => void;
  onRetry: () => void;
};

function TryResultPanel({ state, onDismiss, onRetry }: PanelProps) {
  if (state.kind === "pending") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="ml-4 mb-5 mr-0 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      >
        <span className="font-mono">Generating…</span>
        <span className="ml-2 text-xs">~10–20s for Sonnet to write a single-file demo</span>
      </div>
    );
  }

  const result = state.result;
  if (!result.ok) {
    return (
      <div className="ml-4 mb-5 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        <p className="text-destructive">{result.error}</p>
        <div className="mt-2 flex gap-2">
          <Button variant="ghost" size="sm" onClick={onRetry} className="tap-target">
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss} className="tap-target">
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  const { artifact } = result;
  return (
    <div className="ml-4 mb-5 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{artifact.filename}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="tap-target text-muted-foreground hover:text-foreground"
        >
          ×
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DownloadButton
          filename={artifact.filename}
          content={artifact.content}
          language={artifact.language}
        />
        <CopyRunCommandButton runCommand={artifact.run_command} />
      </div>

      <pre className="mt-3 max-h-60 overflow-auto rounded bg-background/60 p-3 font-mono text-xs leading-snug text-muted-foreground">
        {artifact.content.slice(0, 2000)}
        {artifact.content.length > 2000 ? "\n…" : ""}
      </pre>
    </div>
  );
}

function DownloadButton({
  filename,
  content,
  language,
}: {
  filename: string;
  content: string;
  language: "python" | "html";
}) {
  function onClick() {
    // text/plain works for both .py (no real MIME) and .html (renders as text
    // when downloaded; opening from disk uses the file extension instead).
    const mime = language === "html" ? "text/html" : "text/plain";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <Button onClick={onClick} size="sm" className="tap-target">
      Download {filename}
    </Button>
  );
}

function CopyRunCommandButton({ runCommand }: { runCommand: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(runCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  return (
    <Button
      onClick={onClick}
      variant="outline"
      size="sm"
      className="tap-target border-primary bg-transparent text-primary hover:bg-primary/10 hover:text-primary"
    >
      {copied ? "Copied" : `Copy: ${runCommand}`}
    </Button>
  );
}
