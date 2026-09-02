import { Container } from "@/components/layout/container/container";
import { DemoCard } from "@/components/demos/demo-card/demo-card";
import { DEMOS } from "@/constants/demos";

export function DemoShowcase() {
  return (
    <section className="py-16 sm:py-24">
      <Container>
        <div className="max-w-2xl">
          <p className="text-muted-foreground flex items-center gap-2 font-mono text-[0.625rem] tracking-widest uppercase">
            <span className="bg-primary size-1.5 animate-pulse rounded-full" />
            Live demos
          </p>
          <h1 className="font-heading mt-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Things we built that actually run
          </h1>
          <p className="text-muted-foreground mt-4 leading-relaxed text-pretty">
            Nothing here is a mockup or a screen recording. Every demo talks to
            a live backend, so you can poke at it and see what breaks.
          </p>
        </div>

        <div className="mt-12 grid max-w-5xl items-stretch gap-5 lg:grid-cols-2">
          {DEMOS.map((demo, index) => (
            <DemoCard key={demo.href} {...demo} index={index} />
          ))}
        </div>
      </Container>
    </section>
  );
}
