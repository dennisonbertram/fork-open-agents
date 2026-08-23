import { Component, type ReactNode } from "react";
import type { Decorator, Preview } from "@storybook/react";
import "../app/globals.css";

class StoryErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            maxWidth: 720,
            padding: 24,
            border: "1px solid #f59e0b",
            borderRadius: 8,
            background: "#fffbeb",
            color: "#78350f",
          }}
        >
          <strong>Auto-generated story could not render this component.</strong>
          <p>
            This story renders the component with no props. Components that
            require props, providers, or browser-only context show this notice
            instead.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
            {String(this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Keyed on the story and its args so the boundary REMOUNTS when either changes.
 *
 * Generated stories pass no props, so a component with required props throws on
 * first render and the boundary catches it. Supplying those props through
 * Controls re-renders the same decorated tree rather than remounting it, so
 * without a changing key the caught error would persist and the fallback would
 * stay on screen forever — leaving Controls unable to recover exactly the
 * components that need it most.
 */
const withErrorBoundary: Decorator = (Story, context) => (
  <StoryErrorBoundary
    key={`${context.id}:${JSON.stringify(context.args ?? {})}`}
  >
    <Story />
  </StoryErrorBoundary>
);

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [withErrorBoundary],
};

export default preview;
