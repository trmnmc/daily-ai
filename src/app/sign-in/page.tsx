import { Button } from "@/components/ui/button";

/**
 * /sign-in — magic-link sign-in.
 *
 * Day 1 placeholder. Day 7 wires Supabase Auth's signInWithOtp({ email })
 * and shows a "check your inbox" success state.
 *
 * Note on email rate limit: Supabase's built-in email service caps at 3/hr
 * (decided in /plan-eng-review D1). Stagger invites manually on launch day.
 */

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-3xl font-medium tracking-tight">daily ai</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          AI news that patches your codebase. Sign in with your email and we&apos;ll send a magic link.
        </p>
        <form className="flex flex-col gap-4">
          <input
            type="email"
            required
            placeholder="you@example.com"
            className="rounded-md border border-input bg-muted px-3 py-2 text-sm focus:border-ring focus:outline-none"
            aria-label="Email address"
          />
          <Button type="submit" className="w-full">
            Send magic link
          </Button>
        </form>
        <p className="mt-6 text-xs text-muted-foreground">
          Invite-only in v1. If you don&apos;t have an invite, ask the friend who told you about this.
        </p>
      </div>
    </main>
  );
}
