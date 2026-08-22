import { ManagedRuntimeProfileBuilderRenderer as Component } from "./managed-runtime-profile-builder-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/ManagedRuntimeProfileBuilderRenderer",
  component: Component,
  parameters: {
    generatedFrom:
      "components/tool-call/renderers/managed-runtime-profile-builder-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
