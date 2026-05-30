import type { Metadata } from "next";
import { BackgroundAgentsSection } from "../background-agents-section";

export const metadata: Metadata = {
  title: "Background agents",
  description: "Configure triggered background agents.",
};

export default function BackgroundAgentsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Background agents</h1>
      <BackgroundAgentsSection />
    </>
  );
}
