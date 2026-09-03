import { BroadcastIcon, RobotIcon } from "@phosphor-icons/react/dist/ssr";

import { type Demo } from "@/components/demos/demo-card/demo-card";

export const DEMOS: readonly Demo[] = [
  {
    eyebrow: "Content Sync · SSE",
    title: "Content & Feature Sync",
    description:
      "Change a flag here and every other open browser updates before you can switch tabs. No redeploy, no polling loop, just an open connection doing its job.",
    techStack: ["Python", "MongoDB", "SSE"],
    href: "/demos/content-sync",
    icon: BroadcastIcon,
  },
  {
    eyebrow: "AI Chatbot · RAG",
    title: "AI Document Chatbot",
    description:
      "Give it a document, a file, or a link, then ask about it. The panel on the right shows which passages it actually pulled, so you can tell when the answer is grounded and when it is guessing.",
    techStack: ["RAG", "Vector Search", "Agent Tools"],
    href: "/demos/ai-chatbot",
    icon: RobotIcon,
  },
];

export function getDemoByHref(href: string): Demo | undefined {
  return DEMOS.find((demo) => demo.href === href);
}
