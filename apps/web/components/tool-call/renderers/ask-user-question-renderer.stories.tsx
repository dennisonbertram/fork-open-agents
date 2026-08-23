import { AskUserQuestionRenderer as Component } from "./ask-user-question-renderer";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "ToolCall/Renderers/AskUserQuestionRenderer",
  component: Component,
  parameters: {
    generatedFrom:
      "components/tool-call/renderers/ask-user-question-renderer.tsx",
  },
} satisfies Meta<typeof Component>;

export default meta;

type Story = StoryObj;

export const Default: Story = {};
