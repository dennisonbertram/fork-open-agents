import { CommitDialog as Component } from "./commit-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "CommitDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/commit-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
