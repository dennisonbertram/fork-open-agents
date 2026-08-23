import { DiffsProvider as Component } from "./diffs-provider";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "DiffsProvider",
  component: Component,
  parameters: {
    generatedFrom: "components/diffs-provider.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
