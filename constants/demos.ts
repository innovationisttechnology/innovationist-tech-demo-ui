import { BroadcastIcon, RobotIcon } from "@phosphor-icons/react/dist/ssr";

import { type Demo } from "@/components/demos/demo-card/demo-card";

export const DEMOS: readonly Demo[] = [
  {
    eyebrow: "Content Sync · SSE",
    title: "Content & Feature Sync",
    description:
      "Flip a feature or content value in the dashboard and watch every connected client update instantly over Server-Sent Events — no redeploys, no polling.",
    techStack: ["Python", "MongoDB", "SSE"],
    href: "/demos/content-sync",
    icon: BroadcastIcon,
  },
  {
    eyebrow: "AI Chatbot · RAG",
    title: "AI Document Chatbot",
    description:
      "Upload your documents and ask questions in natural language. Retrieval-augmented generation grounds answers in your content, with a fine-tuned model for tone.",
    techStack: ["RAG", "LLM", "Fine-tuning"],
    href: "/demos/ai-chatbot",
    icon: RobotIcon,
  },
];

export function getDemoByHref(href: string): Demo | undefined {
  return DEMOS.find((demo) => demo.href === href);
}
