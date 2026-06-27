"use client";

import { motion, useReducedMotion } from "motion/react";

const RING_COUNT = 4;
const RIPPLE_DURATION = 7;
const MAX_SIZE = 620;

/**
 * An ambient "water surface" for the card: concentric rings that endlessly
 * swell outward from the centre and fade, staggered so there's always a ripple
 * mid-flight. Purely decorative background motion — independent of the cursor.
 */
export function CardRippleBackground() {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return null;
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute top-1/2 left-1/2">
        {Array.from({ length: RING_COUNT }).map((_unused, ringIndex) => (
          <motion.span
            key={ringIndex}
            className="border-primary/15 absolute rounded-full border"
            style={{ translateX: "-50%", translateY: "-50%" }}
            initial={{ width: 0, height: 0, opacity: 0 }}
            animate={{
              width: MAX_SIZE,
              height: MAX_SIZE,
              opacity: [0, 0.18, 0],
            }}
            transition={{
              duration: RIPPLE_DURATION,
              ease: "easeOut",
              repeat: Infinity,
              delay: ringIndex * (RIPPLE_DURATION / RING_COUNT),
            }}
          />
        ))}
      </div>
    </div>
  );
}
