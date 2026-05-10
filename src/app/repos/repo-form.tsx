"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { addRepo, type AddRepoResult } from "./actions";

export function RepoForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<AddRepoResult | null, FormData>(
    addRepo,
    null,
  );

  // Reset the input on success and surface results as toasts.
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Repo added", { description: state.url });
      formRef.current?.reset();
    } else {
      toast.error("Couldn't add repo", { description: state.error });
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="mt-8 flex gap-2">
      <input
        type="text"
        name="repo_url"
        required
        placeholder="https://github.com/owner/repo"
        className="flex-1 rounded-md border border-input bg-muted px-3 py-2 font-mono text-sm focus:border-ring focus:outline-none"
        aria-label="GitHub repo URL"
      />
      <AddButton />
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="tap-target">
      {pending ? "Adding…" : "Add"}
    </Button>
  );
}
