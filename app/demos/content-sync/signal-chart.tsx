"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { scaleLinear } from "d3-scale";
import { line as lineGenerator, curveMonotoneX } from "d3-shape";

export type SignalStyle = "solid" | "dotted" | "circles";

export type SignalFlag = {
  key: string;
  text: string;
  color: string;
  zeta: number; // damping ratio
  amplitude: number; // peak height of the curve
  style: SignalStyle;
};

const MARGIN = { top: 38, right: 20, bottom: 26, left: 38 };
const T_MIN = 0;
const T_MAX = 4;
const SAMPLE_COUNT = 200;
const ANGULAR_FREQUENCY = 2 * Math.PI; // one oscillation per unit of t
const SWEEP_PERIOD_MS = 12000;
const Y_TICKS = [1, 0.5, 0, -0.5, -1];
const X_TICKS = [0, 1, 2, 3, 4];

const SAMPLE_TIMES = Array.from(
  { length: SAMPLE_COUNT + 1 },
  (_, index) => T_MIN + (index / SAMPLE_COUNT) * (T_MAX - T_MIN),
);
const MARKER_TIMES = [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4];

// Damped harmonic oscillator, normalised to start at 1.0 when t = 0.
function signalValue(zeta: number, time: number): number {
  if (zeta <= 0) {
    return Math.cos(ANGULAR_FREQUENCY * time);
  }
  if (zeta >= 1) {
    return (1 + ANGULAR_FREQUENCY * time) * Math.exp(-ANGULAR_FREQUENCY * time);
  }
  const dampedFrequency = ANGULAR_FREQUENCY * Math.sqrt(1 - zeta * zeta);
  return (
    Math.exp(-zeta * ANGULAR_FREQUENCY * time) *
    Math.cos(dampedFrequency * time)
  );
}

function valueFor(flag: SignalFlag, time: number): number {
  return flag.amplitude * signalValue(flag.zeta, time);
}

function dashForStyle(style: SignalStyle): string | undefined {
  if (style === "dotted") {
    return "1 7";
  }
  return undefined;
}

type Size = { width: number; height: number };

export function SignalChart({ flags }: { flags: readonly SignalFlag[] }) {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<SVGLineElement>(null);
  const dotNodes = useRef(new Map<string, SVGCircleElement>());
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const innerWidth = size.width - MARGIN.left - MARGIN.right;
  const innerHeight = size.height - MARGIN.top - MARGIN.bottom;

  const scales = useMemo(() => {
    return {
      x: scaleLinear()
        .domain([T_MIN, T_MAX])
        .range([0, Math.max(innerWidth, 0)]),
      y: scaleLinear()
        .domain([-1.15, 1.15])
        .range([Math.max(innerHeight, 0), 0]),
    };
  }, [innerWidth, innerHeight]);

  const curves = useMemo(() => {
    if (innerWidth <= 0 || innerHeight <= 0) {
      return [];
    }
    const buildPath = lineGenerator<{ time: number; value: number }>()
      .x((point) => scales.x(point.time))
      .y((point) => scales.y(point.value))
      .curve(curveMonotoneX);

    return flags.map((flag) => {
      const points = SAMPLE_TIMES.map((time) => ({
        time,
        value: valueFor(flag, time),
      }));
      return {
        flag,
        path: buildPath(points) ?? "",
        markers:
          flag.style === "circles"
            ? MARKER_TIMES.map((time) => ({
                cx: scales.x(time),
                cy: scales.y(valueFor(flag, time)),
              }))
            : [],
      };
    });
  }, [flags, scales, innerWidth, innerHeight]);

  // Animate only the playhead and its dots; the curves stay static.
  useEffect(() => {
    if (innerWidth <= 0 || innerHeight <= 0) {
      return;
    }

    function place(time: number) {
      const x = scales.x(time);
      playheadRef.current?.setAttribute("x1", `${x}`);
      playheadRef.current?.setAttribute("x2", `${x}`);
      flags.forEach((flag) => {
        const node = dotNodes.current.get(flag.key);
        if (node) {
          node.setAttribute("cx", `${x}`);
          node.setAttribute("cy", `${scales.y(valueFor(flag, time))}`);
        }
      });
    }

    if (prefersReducedMotion) {
      place(3);
      return;
    }

    let frame = 0;
    function loop(elapsed: number) {
      const phase = (elapsed % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS;
      // Smooth ping-pong across [T_MIN, T_MAX].
      const time =
        (T_MIN + T_MAX) / 2 -
        ((T_MAX - T_MIN) / 2) * Math.cos(phase * 2 * Math.PI);
      place(time);
      frame = requestAnimationFrame(loop);
    }
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [flags, scales, innerWidth, innerHeight, prefersReducedMotion]);

  const ready = innerWidth > 0 && innerHeight > 0;
  const initialTime = 3;

  return (
    <div
      ref={containerRef}
      className="border-border bg-card relative h-72 w-full overflow-hidden rounded-lg border sm:h-80"
    >
      <div className="text-muted-foreground pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 px-4 py-2.5 font-mono text-[0.625rem] tracking-widest uppercase">
        <span className="flex shrink-0 items-center gap-2">
          &gt; flags(t)
          <span className="text-primary flex items-center gap-1.5">
            <span className="bg-primary size-1.5 animate-pulse rounded-full" />
            live
          </span>
        </span>
        {flags.length > 0 ? (
          <span className="flex flex-wrap justify-end gap-x-3 gap-y-1 tracking-wider">
            {flags.map((flag) => (
              <span
                key={flag.key}
                className="flex items-center gap-1.5"
                style={{ color: flag.color }}
              >
                <svg width="16" height="6" aria-hidden>
                  <line
                    x1="0"
                    y1="3"
                    x2="16"
                    y2="3"
                    stroke={flag.color}
                    strokeWidth="1.5"
                    strokeDasharray={dashForStyle(flag.style)}
                    strokeLinecap="round"
                  />
                </svg>
                {flag.text}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      {ready ? (
        <svg
          className="absolute inset-0 h-full w-full"
          width={size.width}
          height={size.height}
          aria-hidden
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {Y_TICKS.map((tick) => (
              <g key={`y-${tick}`}>
                <line
                  x1={0}
                  x2={innerWidth}
                  y1={scales.y(tick)}
                  y2={scales.y(tick)}
                  className="stroke-foreground"
                  strokeOpacity={tick === 0 ? 0.22 : 0.1}
                />
                <text
                  x={-8}
                  y={scales.y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground font-mono text-[9px]"
                >
                  {tick.toFixed(1)}
                </text>
              </g>
            ))}

            {X_TICKS.map((tick) => (
              <text
                key={`x-${tick}`}
                x={scales.x(tick)}
                y={innerHeight + 16}
                textAnchor="middle"
                className="fill-white/35 font-mono text-[9px]"
              >
                {tick}
              </text>
            ))}

            {curves.map(({ flag, path, markers }) => (
              <g key={flag.key}>
                <path
                  d={path}
                  fill="none"
                  stroke={flag.color}
                  strokeWidth={flag.style === "circles" ? 1 : 1.75}
                  strokeOpacity={flag.style === "circles" ? 0.45 : 0.95}
                  strokeDasharray={dashForStyle(flag.style)}
                  strokeLinecap="round"
                />
                {markers.map((marker, markerIndex) => (
                  <circle
                    key={markerIndex}
                    cx={marker.cx}
                    cy={marker.cy}
                    r={2.5}
                    fill={flag.color}
                  />
                ))}
              </g>
            ))}

            <line
              ref={playheadRef}
              x1={scales.x(initialTime)}
              x2={scales.x(initialTime)}
              y1={0}
              y2={innerHeight}
              className="stroke-foreground"
              strokeOpacity={0.4}
              strokeWidth={1}
              strokeDasharray="2 3"
            />

            {flags.map((flag) => (
              <circle
                key={flag.key}
                ref={(node) => {
                  if (node) {
                    dotNodes.current.set(flag.key, node);
                  } else {
                    dotNodes.current.delete(flag.key);
                  }
                }}
                cx={scales.x(initialTime)}
                cy={scales.y(valueFor(flag, initialTime))}
                r={4}
                fill={flag.color}
                className="stroke-card"
                strokeWidth={1.5}
              />
            ))}
          </g>
        </svg>
      ) : null}

      {flags.length === 0 ? (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center font-mono text-xs">
          No active flags — add a word or enable one below.
        </div>
      ) : null}
    </div>
  );
}
