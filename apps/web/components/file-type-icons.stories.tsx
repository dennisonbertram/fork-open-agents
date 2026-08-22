import { FolderIcon as Component } from "./file-type-icons";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "FileTypeIcons",
  component: Component,
  parameters: {
    generatedFrom: "components/file-type-icons.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
