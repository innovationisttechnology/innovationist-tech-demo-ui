"use client";

import {
  motion,
  useSpring,
  useReducedMotion,
  type MotionValue,
} from "motion/react";

const TRAIL_LENGTH = 14;

type CursorTrailProps = {
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  active: boolean;
};

/**
 * A comet-like trail of blurred primary-coloured blobs that lag behind the
 * cursor with progressively softer springs — like the ripples flowing off a
 * finger dragged through a river. Each blob follows the cursor with a little
 * more delay and a little more blur than the one before it, so they string out
 * into a flowing tail while the cursor moves and gently pool back together when
 * it stops.
 */
export function CursorTrail({ pointerX, pointerY, active }: CursorTrailProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return null;
  }

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      {Array.from({ length: TRAIL_LENGTH }).map((_unused, trailIndex) => (
        <TrailBlob
          key={trailIndex}
          pointerX={pointerX}
          pointerY={pointerY}
          index={trailIndex}
          active={active}
        />
      ))}
    </div>
  );
}

type TrailBlobProps = {
  pointerX: MotionValue<number>;
  pointerY: MotionValue<number>;
  index: number;
  active: boolean;
};

function TrailBlob({ pointerX, pointerY, index, active }: TrailBlobProps) {
  // `progress` runs 0 (head, nearest the cursor) → 1 (far tail).
  const progress = index / (TRAIL_LENGTH - 1);

  // Later blobs use a softer, heavier spring so they lag further behind and
  // create the flowing tail.
  const springConfig = {
    stiffness: 420 - progress * 320,
    damping: 30 - progress * 12,
    mass: 0.4 + progress * 0.9,
  };

  const blobX = useSpring(pointerX, springConfig);
  const blobY = useSpring(pointerY, springConfig);

  // Head blobs are small and crisp; tail blobs grow and blur out as they fade.
  const size = 10 + progress * 26;
  const blur = progress * 9;
  const opacity = (1 - progress) * 0.5;

  return (
    <motion.span
      className="bg-primary absolute top-0 left-0 rounded-full"
      style={{
        x: blobX,
        y: blobY,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        filter: `blur(${blur}px)`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: active ? opacity : 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    />
  );
}
