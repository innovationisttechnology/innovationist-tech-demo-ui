import type { Metadata } from "next";

import { Container } from "@/components/layout/container/container";
import { getDemoByHref } from "@/constants/demos";

const demo = getDemoByHref("/demos/ai-chatbot");

export const metadata: Metadata = {
  title: demo ? `${demo.title} — InnovationistTech Demos` : "Demo",
};

export default function AiChatbotDemoPage() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <h1 className="text-primary text-xs font-semibold tracking-widest uppercase">
          {demo?.title ?? "AI Document Chatbot"}
        </h1>
      </Container>
    </section>
  );
}
