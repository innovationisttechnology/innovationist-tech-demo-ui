"use client";

import { useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import {
  motion,
  useMotionValue,
  useAnimationControls,
  useReducedMotion,
} from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CursorTrail } from "@/components/demos/demo-card/cursor-trail";
import { CursorRipples } from "@/components/demos/demo-card/cursor-ripples";
import { CardRippleBackground } from "@/components/demos/demo-card/card-ripple-background";

export type Demo = {
  eyebrow: string;
  title: string;
  description: string;
  techStack: readonly string[];
  href: string;
  sourceUrl?: string;
  icon: Icon;
};

export function DemoCard({
  eyebrow,
  title,
  description,
  techStack,
  href,
  sourceUrl,
  icon: PreviewIcon,
  index,
}: Demo & { index: number }) {
  const prefersReducedMotion = useReducedMotion();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pointerX = useMotionValue(-100);
  const pointerY = useMotionValue(-100);
  const vibrateControls = useAnimationControls();
  const hasVibrated = useRef(false);
  const [trailActive, setTrailActive] = useState(false);

  function handlePointerEnter() {
    setTrailActive(true);

    if (prefersReducedMotion || hasVibrated.current) {
      return;
    }

    hasVibrated.current = true;
    vibrateControls.start({
      x: [0, -5, 5, -4, 4, -2, 2, 0],
      transition: { duration: 0.45, ease: "easeInOut" },
    });
  }

  function handlePointerMove(event: MouseEvent<HTMLDivElement>) {
    const bounds = wrapperRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    pointerX.set(event.clientX - bounds.left);
    pointerY.set(event.clientY - bounds.top);
  }

  function handlePointerLeave() {
    setTrailActive(false);
  }

  return (
    <motion.div
      ref={wrapperRef}
      animate={vibrateControls}
      onMouseEnter={handlePointerEnter}
      onMouseMove={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      className="h-full"
    >
      <Card className="group hover:ring-primary/30 relative isolate h-full min-h-96 overflow-hidden transition-all duration-300 [--card-spacing:--spacing(12)] hover:-translate-y-1 hover:shadow-xl">
        <CardRippleBackground />
        <CursorTrail
          pointerX={pointerX}
          pointerY={pointerY}
          active={trailActive}
        />
        <CursorRipples
          pointerX={pointerX}
          pointerY={pointerY}
          active={trailActive}
        />

        {/* Ghosted index watermark */}
        <span
          aria-hidden
          className="font-heading text-primary/[0.08] pointer-events-none absolute -top-8 right-1 text-[9rem] leading-none font-bold select-none"
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        {/* Animated top accent */}
        <span
          aria-hidden
          className="from-primary absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-gradient-to-r to-transparent transition-transform duration-500 group-hover:scale-x-100"
        />

        {/* Corner glow on hover */}
        <span
          aria-hidden
          className="bg-primary/10 pointer-events-none absolute -right-16 -bottom-16 size-40 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
        />

        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="border-border bg-muted/40 text-primary group-hover:border-primary/40 group-hover:bg-primary/10 flex size-12 shrink-0 items-center justify-center border transition-colors">
              <PreviewIcon weight="duotone" className="size-6" />
            </div>
            <span className="text-muted-foreground flex items-center gap-2 text-[0.625rem] font-semibold tracking-widest uppercase">
              <span className="bg-primary shadow-primary/50 size-1.5 rounded-full shadow-[0_0_8px_1px]" />
              {eyebrow}
            </span>
          </div>
        </CardHeader>

        <CardContent>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription className="mt-3">{description}</CardDescription>

          <ul className="mt-6 flex flex-wrap gap-2">
            {techStack.map((tech) => (
              <li key={tech}>
                <Badge
                  variant="secondary"
                  className="border-border border px-2 py-0.5"
                >
                  {tech}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>

        <CardFooter className="mt-auto gap-2">
          <Button asChild>
            <Link
              href={href}
              className="after:absolute after:inset-0 after:content-['']"
            >
              View live demo
              <ArrowRightIcon
                weight="bold"
                data-icon="inline-end"
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </Button>
          {sourceUrl ? (
            <Button variant="ghost" asChild className="relative z-10">
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                <GithubLogoIcon weight="fill" data-icon="inline-start" />
                Source
              </a>
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </motion.div>
  );
}
