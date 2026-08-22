import { TextAttachmentsPreview as Component } from "./text-attachments-preview";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "TextAttachmentsPreview",
  component: Component,
  parameters: {
    generatedFrom: "components/text-attachments-preview.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
