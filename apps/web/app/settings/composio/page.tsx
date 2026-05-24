import type { Metadata } from "next";
import { ComposioSection } from "../composio-section";

export const metadata: Metadata = {
  title: "Composio",
  description: "Configure Composio tool profiles and agent access.",
};

export default function ComposioPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Composio</h1>
      <ComposioSection />
    </>
  );
}
