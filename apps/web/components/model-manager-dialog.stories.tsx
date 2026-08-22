import { ModelManagerDialog as Component } from "./model-manager-dialog";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ModelManagerDialog",
  component: Component,
  parameters: {
    generatedFrom: "components/model-manager-dialog.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
