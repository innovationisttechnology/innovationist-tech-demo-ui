import type { Metadata } from "next";

import { Container } from "@/components/layout/container/container";
import { getDemoByHref } from "@/constants/demos";
import { ContentSyncDemo } from "./content-sync-demo";

const demo = getDemoByHref("/demos/content-sync");

export const metadata: Metadata = {
  title: demo ? `${demo.title} — InnovationistTech Demos` : "Demo",
};

export default function ContentSyncDemoPage() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <h1 className="text-primary text-xs font-semibold tracking-widest uppercase">
          {demo?.title ?? "Content & Feature Sync"}
        </h1>
        <div className="mt-8">
          <ContentSyncDemo />
        </div>
      </Container>
    </section>
  );
}
