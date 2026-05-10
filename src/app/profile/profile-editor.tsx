"use client";

import { useActionState, useEffect, useId } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { updateProfile, type UpdateProfileResult } from "./actions";

const ONBOARDING_PLACEHOLDER = `Tell daily ai about your stack. The more specific you are, the better the feed gets.

Example:
I'm building a RAG product with LangChain and pgvector. I care about retrieval quality, prompt caching, and reducing per-query LLM cost. I work in TypeScript day-to-day; I'm willing to drop into Python for ML pieces. I'm trying to learn more about reasoning models without spending a quarter on it.`;

type ProfileEditorProps = {
  /** Current profile_md from the DB. Empty string if never saved. */
  initial: string;
};

export function ProfileEditor({ initial }: ProfileEditorProps) {
  const textareaId = useId();
  const [state, formAction] = useActionState<UpdateProfileResult | null, FormData>(
    updateProfile,
    null,
  );

  // Surface server-action results as toasts. We key the effect on `state` so
  // a no-op re-render won't re-fire the toast — only an actual new result will.
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Profile saved", {
        description: "Next scoring run will use this.",
      });
    } else {
      toast.error("Couldn't save profile", { description: state.error });
    }
  }, [state]);

  return (
    <form action={formAction}>
      <Textarea
        id={textareaId}
        name="profile_md"
        defaultValue={initial}
        placeholder={ONBOARDING_PLACEHOLDER}
        className="min-h-[280px] font-mono text-sm leading-relaxed"
        aria-label="profile.md content"
      />
      <div className="mt-4 flex items-center justify-end gap-3">
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="tap-target">
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}
