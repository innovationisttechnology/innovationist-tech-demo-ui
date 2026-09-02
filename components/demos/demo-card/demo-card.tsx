import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export type Demo = {
  eyebrow: string;
  title: string;
  description: string;
  techStack: readonly string[];
  href: string;
  icon: Icon;
};

/**
 * The whole card is one anchor, with the card nested inside it.
 *
 * The previous version kept the anchor in the footer and stretched it over the
 * card with an `after:inset-0` overlay. That broke: on mousedown the overlay
 * stopped covering the card, so mouseup landed on the card body instead, and
 * the browser dispatched `click` on their common ancestor rather than the link.
 * The visible button still worked, so the card looked selectively dead.
 *
 * Wrapping instead of overlaying means hit-testing is plain box containment —
 * nothing to collapse, and the focus ring lands on the real target for free.
 * The trade-off is that no other interactive element can live inside the card,
 * since a nested anchor or button would be invalid HTML.
 */
export function DemoCard({
  eyebrow,
  title,
  description,
  techStack,
  href,
  icon: PreviewIcon,
  index,
}: Demo & { index: number }) {
  return (
    <Link
      href={href}
      className="group focus-visible:ring-ring/50 focus-visible:ring-offset-background block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <Card className="hover:border-primary/40 relative flex h-full flex-col overflow-hidden transition-colors [--card-spacing:--spacing(8)]">
        {/* Always on rather than a hover reveal — the card should read as a
            live thing at rest, not reward pointing at it. */}
        <span
          aria-hidden
          className="from-primary/60 absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent"
        />

        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <span className="border-border bg-muted/40 text-primary flex size-10 shrink-0 items-center justify-center rounded-md border">
              <PreviewIcon weight="duotone" className="size-5" />
            </span>
            <span className="text-muted-foreground font-mono text-[0.625rem] tracking-widest tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>
        </CardHeader>

        <CardContent className="flex-1">
          <p className="text-muted-foreground flex items-center gap-2 font-mono text-[0.625rem] tracking-widest uppercase">
            <span className="bg-primary size-1.5 rounded-full" />
            {eyebrow}
          </p>

          <CardTitle className="mt-3 text-2xl">
            <h3>{title}</h3>
          </CardTitle>

          <CardDescription className="mt-2 leading-relaxed">
            {description}
          </CardDescription>

          <ul className="mt-5 flex flex-wrap gap-1.5">
            {techStack.map((tech) => (
              <li key={tech}>
                <Badge variant="secondary">{tech}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>

        <CardFooter className="mt-auto">
          {/* A span, not a Button: the anchor is the card wrapper, and nesting
              another interactive element inside it would be invalid HTML. */}
          <span className={buttonVariants({ variant: "default" })}>
            View live demo
            <ArrowRightIcon
              weight="bold"
              data-icon="inline-end"
              className="transition-transform group-hover:translate-x-0.5"
            />
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
}
