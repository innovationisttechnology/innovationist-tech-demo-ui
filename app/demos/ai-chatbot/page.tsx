import type { Metadata } from "next";

import { Container } from "@/components/layout/container/container";
import { getDemoByHref } from "@/constants/demos";
import { AiChatbotDemo } from "./ai-chatbot-demo";

const demo = getDemoByHref("/demos/ai-chatbot");

export const metadata: Metadata = {
  title: demo?.title ?? "Demo",
};

export default function AiChatbotDemoPage() {
  return (
    <section className="py-8 sm:py-10">
      <Container>
        {/*
          The green eyebrow line is the page's h1 — same pattern as the
          content-sync demo. Keeping it a heading means the page still has a
          document outline even though it reads as a label.
        */}
        <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-primary text-xs font-semibold tracking-widest uppercase">
            {demo?.eyebrow ?? "AI Chatbot · RAG"}
          </span>
          <span className="text-muted-foreground font-sans text-sm font-normal">
            Give it something to read, then ask about it.
          </span>
        </h1>

        <div className="mt-5">
          <AiChatbotDemo />
        </div>
      </Container>
    </section>
  );
}
