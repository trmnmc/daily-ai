import { Button } from "@/components/ui/button";

/**
 * A single feed item.
 *
 * NOT a card. No background, no shadow, no border-radius. Just type
 * separated by hairline dividers (parent renders the divider).
 *
 * Visual hierarchy (top to bottom):
 *   1. Source dot + name + timestamp                 (small; dot adds source identity)
 *   2. "Why I care" line                             (BIGGEST — 24px, the spine)
 *   3. Title                                          (medium, muted: context, not hero)
 *   4. Three buttons: Ignore / Try / Patch           (right-aligned, mobile-stacked)
 *
 * The "why I care" line being the biggest type — bigger than the title — is
 * the inversion that makes this feel different from Smol AI / Particle. The
 * title is the news; the personal angle is the signal. Sort by signal.
 *
 * Hover state: a 2px left edge in --primary slides into view. Sets up the
 * j/k vim navigation visual without requiring keyboard nav to be wired yet.
 */

export type FeedItemData = {
  id: string;
  source: string;
  timestamp: string; // already formatted, e.g. "2h ago"
  title: string;
  whyICare: string;
  url: string;
};

type FeedItemProps = {
  item: FeedItemData;
  onIgnore?: (id: string) => void;
  onTry?: (id: string) => void;
  onPatch?: (id: string) => void;
};

/**
 * Per-source dot color. A 6px circle before the source name. Adds visual
 * identity at a glance without breaking the minimal aesthetic — total color
 * footprint is ~30 pixels per item.
 *
 * Defaults to a muted gray for unrecognized sources so the system is
 * forgiving when v2 adds new feeds.
 */
function sourceDotClass(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("anthropic")) return "bg-primary"; // brand orange — direct callback
  if (s.includes("hacker news") || s.includes("hn")) return "bg-[#FF6600]"; // HN's signature orange
  if (s.includes("github")) return "bg-[#A371F7]"; // GitHub's signature purple
  if (s.includes("arxiv")) return "bg-[#B31B1B]"; // arXiv's signature red
  if (s.includes("openai")) return "bg-[#10A37F]"; // OpenAI green
  return "bg-muted-foreground"; // fallback
}

export function FeedItem({ item, onIgnore, onTry, onPatch }: FeedItemProps) {
  return (
    <article
      role="article"
      aria-labelledby={`item-${item.id}-title`}
      className="group relative flex flex-col gap-3 py-5 pl-4 transition-colors before:absolute before:left-0 before:top-5 before:h-[calc(100%-2.5rem)] before:w-[2px] before:bg-transparent before:transition-colors hover:before:bg-primary"
    >
      {/* Source + timestamp — small, with a colored dot for source identity */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          aria-hidden
          className={`inline-block h-1.5 w-1.5 rounded-full ${sourceDotClass(item.source)}`}
        />
        <span aria-label={`Source: ${item.source}, published ${item.timestamp}`}>
          {item.source}
          <span className="mx-2 text-muted-foreground/50">·</span>
          <span className="font-mono">{item.timestamp}</span>
        </span>
      </div>

      {/* Why I care — the hero. 24px, tight line-height, foreground.
          Bigger than the title because this is what the user actually opens
          the app to read. Title is the context; this is the signal. */}
      <p className="text-2xl font-medium leading-tight text-foreground">
        {item.whyICare}
      </p>

      {/* Title — the news context underneath the personal take.
          Muted color and smaller size signal "this is the underlying article,
          if you want it." Click-through goes to the source URL. */}
      <h2
        id={`item-${item.id}-title`}
        className="text-sm leading-snug text-muted-foreground"
      >
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-foreground"
        >
          {item.title}
        </a>
      </h2>

      {/* Action buttons. Inline-end on >=640px, stacked below.
          - Try: filled primary (the most-used action; this is where color shouts)
          - Patch: outlined primary text (bolder operation, quieter button — visual restraint)
          - Ignore: ghost; only the muted text shows until hover, then destructive red */}
      <div
        role="group"
        aria-label={`Actions for ${item.title}`}
        className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onIgnore?.(item.id)}
          className="tap-target text-muted-foreground hover:bg-transparent hover:text-destructive sm:order-1"
        >
          Ignore
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={() => onTry?.(item.id)}
          className="tap-target sm:order-2"
        >
          Try
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPatch?.(item.id)}
          className="tap-target border-primary bg-transparent text-primary hover:border-primary hover:bg-primary/10 hover:text-primary sm:order-3"
        >
          Patch
        </Button>
      </div>
    </article>
  );
}
