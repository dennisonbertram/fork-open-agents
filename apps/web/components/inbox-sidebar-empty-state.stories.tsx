import { InboxSidebarEmptyState as Component } from "./inbox-sidebar-empty-state";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "InboxSidebarEmptyState",
  component: Component,
  parameters: {
    generatedFrom: "components/inbox-sidebar-empty-state.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
