import { ImageAttachmentsPreview as Component } from "./image-attachments-preview";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ImageAttachmentsPreview",
  component: Component,
  parameters: {
    generatedFrom: "components/image-attachments-preview.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
