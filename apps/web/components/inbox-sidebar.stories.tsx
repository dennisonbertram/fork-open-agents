import { InboxSidebar as Component } from "./inbox-sidebar";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "InboxSidebar",
  component: Component,
  parameters: {
    generatedFrom: "components/inbox-sidebar.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
