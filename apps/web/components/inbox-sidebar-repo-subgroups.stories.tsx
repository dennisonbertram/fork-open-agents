import { RepoAgentsSubGroup as Component } from "./inbox-sidebar-repo-subgroups";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "InboxSidebarRepoSubgroups",
  component: Component,
  parameters: {
    generatedFrom: "components/inbox-sidebar-repo-subgroups.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
