import { SessionStarterVercelSyncSection as Component } from "./session-starter-vercel-sync-section";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "SessionStarterVercelSyncSection",
  component: Component,
  parameters: {
    generatedFrom: "components/session-starter-vercel-sync-section.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
