import { RunMetadataTable as Component } from "./run-metadata-table";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "RunMetadataTable",
  component: Component,
  parameters: {
    generatedFrom: "components/run-metadata-table.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
