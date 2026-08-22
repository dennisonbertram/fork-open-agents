import { InboxSidebarRenameDialog as Component } from "./inbox-sidebar-rename-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "InboxSidebarRenameDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/inbox-sidebar-rename-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
