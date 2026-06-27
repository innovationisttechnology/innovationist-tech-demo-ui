"use client";

import { Container } from "@/components/layout/container/container";
import { DemoCard } from "@/components/demos/demo-card/demo-card";
import { DEMOS } from "@/constants/demos";

export function DemoShowcase() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <div className="max-w-2xl">
          <p className="text-primary text-xs font-semibold tracking-widest uppercase">
            Live Demos
          </p>
        </div>

        <div className="mt-12 grid max-w-5xl items-stretch gap-6 lg:grid-cols-2">
          {DEMOS.map((demo, index) => (
            <DemoCard key={demo.href} {...demo} index={index} />
          ))}
        </div>
      </Container>
    </section>
  );
}
