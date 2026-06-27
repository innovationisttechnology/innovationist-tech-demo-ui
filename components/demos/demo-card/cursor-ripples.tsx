"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type MotionValue,
} from "motion/react";

// Minimum distance (px) the cursor must travel before another ripple is born,
// so the rings space themselves out along the path instead of stacking up.
const SPAWN_DISTANCE = 40;

type Ripple = { id: number; x: number; y: number };

type CursorRipplesProps = {
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  active: boolean;
};

/**
 * Expanding rings that bloom from the cursor as it travels across the card —
 * the spreading water rings left behind a finger dragged through a river. A new
 * ripple is spawned every time the cursor moves a set distance, then each ring
 * grows outward and fades away on its own.
 */
export function CursorRipples({
  pointerX,
  pointerY,
  active,
}: CursorRipplesProps) {
  const prefersReducedMotion = useReducedMotion();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const lastSpawn = useRef<{ x: number; y: number } | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    function maybeSpawnRipple() {
      if (!active) {
        return;
      }

      const x = pointerX.get();
      const y = pointerY.get();
      const previous = lastSpawn.current;

      if (previous) {
        const distance = Math.hypot(x - previous.x, y - previous.y);
        if (distance < SPAWN_DISTANCE) {
          return;
        }
      }

      lastSpawn.current = { x, y };
      const id = nextId.current++;
      setRipples((current) => [...current, { id, x, y }]);
    }

    const unsubscribeX = pointerX.on("change", maybeSpawnRipple);
    const unsubscribeY = pointerY.on("change", maybeSpawnRipple);

    return () => {
      unsubscribeX();
      unsubscribeY();
    };
  }, [active, pointerX, pointerY, prefersReducedMotion]);

  function removeRipple(id: number) {
    setRipples((current) => current.filter((ripple) => ripple.id !== id));
  }

  if (prefersReducedMotion) {
    return null;
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.span
            key={ripple.id}
            className="border-primary/40 absolute rounded-full border"
            style={{
              left: ripple.x,
              top: ripple.y,
              translateX: "-50%",
              translateY: "-50%",
            }}
            initial={{ width: 0, height: 0, opacity: 0.5 }}
            animate={{ width: 170, height: 170, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            onAnimationComplete={() => removeRipple(ripple.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
