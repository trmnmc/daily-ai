import Link from "next/link";

/**
 * Top navigation, persistent across all signed-in pages.
 *
 * Layout:
 *   ┌────────────────────────────────────────┐
 *   │ daily ai          [profile] [repos]    │
 *   └────────────────────────────────────────┘
 *
 * Wordmark in --foreground; nav links in --muted-foreground until hover.
 * The wordmark is lowercase by convention — it's a daily ritual surface,
 * not a brand-shouting moment.
 */
export function TopNav() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-[720px] items-center justify-between px-4 py-4">
        <Link
          href="/"
          className="group flex items-center gap-2 text-base font-medium tracking-tight text-foreground transition-colors hover:text-primary"
          aria-label="daily ai — home"
        >
          {/* The ▌ block: reads as a log entry, a cursor, a build queue marker.
              This is the favicon and the only piece of color in the nav. */}
          <span
            aria-hidden
            className="font-mono text-primary transition-transform group-hover:translate-x-[1px]"
          >
            ▌
          </span>
          <span>daily ai</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/profile"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            profile
          </Link>
          <Link
            href="/repos"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            repos
          </Link>
        </nav>
      </div>
    </header>
  );
}
