"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import {
  refreshRepo,
  removeRepo,
  type RefreshRepoResult,
  type RemoveRepoResult,
} from "./actions";

type Props = {
  repoId: string;
  repoUrl: string;
};

/**
 * Per-row Refresh + Remove actions. Each is its own form so `useActionState`
 * handles them independently — a failed refresh doesn't reset the remove
 * button's pending state and vice versa. Remove uses a native confirm()
 * gate (smallest safe destructive-action pattern for v1).
 */
export function RepoRowActions({ repoId, repoUrl }: Props) {
  return (
    <div className="flex items-center gap-1">
      <RefreshForm repoId={repoId} repoUrl={repoUrl} />
      <RemoveForm repoId={repoId} repoUrl={repoUrl} />
    </div>
  );
}

function RefreshForm({ repoId, repoUrl }: Props) {
  const [state, formAction] = useActionState<RefreshRepoResult | null, FormData>(
    refreshRepo,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Refreshed", { description: state.url });
    } else {
      toast.error("Couldn't refresh", { description: state.error });
    }
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={repoId} />
      <RefreshButton repoUrl={repoUrl} />
    </form>
  );
}

function RefreshButton({ repoUrl }: { repoUrl: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`Refresh ${repoUrl}`}
      className="tap-target text-muted-foreground hover:bg-transparent hover:text-foreground"
    >
      {pending ? "Refreshing…" : "Refresh"}
    </Button>
  );
}

function RemoveForm({ repoId, repoUrl }: Props) {
  const [state, formAction] = useActionState<RemoveRepoResult | null, FormData>(
    removeRepo,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Removed", { description: state.url });
    } else {
      toast.error("Couldn't remove", { description: state.error });
    }
  }, [state]);

  // Native confirm is the smallest safe destructive-action gate. A nicer
  // shadcn AlertDialog can ship later; the cost of a mistaken remove is low
  // (re-paste the URL).
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!window.confirm(`Remove ${repoUrl}?`)) {
      e.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={onSubmit}>
      <input type="hidden" name="id" value={repoId} />
      <RemoveButton repoUrl={repoUrl} />
    </form>
  );
}

function RemoveButton({ repoUrl }: { repoUrl: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`Remove ${repoUrl}`}
      className="tap-target text-muted-foreground hover:bg-transparent hover:text-destructive"
    >
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}
