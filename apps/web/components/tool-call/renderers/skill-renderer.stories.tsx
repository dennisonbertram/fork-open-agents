import { SkillRenderer as Component } from "./skill-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/SkillRenderer",
  component: Component,
  parameters: {
    generatedFrom: "components/tool-call/renderers/skill-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
