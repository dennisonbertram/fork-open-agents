import { CreateRepoDialog as Component } from "./create-repo-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "CreateRepoDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/create-repo-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
