import type { LoopValidationError } from "@/lib/agent-loops/types";
import type { LoopFlowEdge, LoopFlowNode } from "./definition-mapping";

export type BuilderGuidanceStep = {
  id: string;
  title: string;
  detail: string;
  state: "done" | "current" | "blocked";
};

export type BuilderGuidance = {
  headline: string;
  detail: string;
  steps: BuilderGuidanceStep[];
};

function selectedNodeLabel(nodes: LoopFlowNode[]): string | null {
  return nodes.find((node) => node.selected)?.data.label ?? null;
}

function hasNodeKind(
  nodes: LoopFlowNode[],
  kind: LoopFlowNode["data"]["kind"],
) {
  return nodes.some((node) => node.data.kind === kind);
}

function hasWorkCard(nodes: LoopFlowNode[]) {
  return nodes.some(
    (node) => node.data.kind !== "start" && node.data.kind !== "end",
  );
}

function nodeHasOutgoingEdge(edges: LoopFlowEdge[], nodeId: string) {
  return edges.some((edge) => edge.source === nodeId);
}

function firstHelpfulError(errors: LoopValidationError[]) {
  return errors.find((error) =>
    [
      "no_outgoing_edge",
      "missing_condition_edge",
      "missing_node_config",
      "missing_condition_value",
      "invalid_when",
      "invalid_condition_edge",
      "dangling_edge",
    ].includes(error.rule),
  );
}

export function buildBuilderGuidance({
  nodes,
  edges,
  validationErrors,
  isDirty,
}: {
  nodes: LoopFlowNode[];
  edges: LoopFlowEdge[];
  validationErrors: LoopValidationError[];
  isDirty: boolean;
}): BuilderGuidance {
  const selected = selectedNodeLabel(nodes);
  const hasStart = hasNodeKind(nodes, "start");
  const hasRunnableCard = hasWorkCard(nodes);
  const hasEnd = hasNodeKind(nodes, "end");
  const startNode = nodes.find((node) => node.data.kind === "start");
  const startIsConnected = startNode
    ? nodeHasOutgoingEdge(edges, startNode.id)
    : false;
  const helpfulError = firstHelpfulError(validationErrors);
  const isValid = validationErrors.length === 0;

  const steps: BuilderGuidanceStep[] = [
    {
      id: "start",
      title: "Start with one work card",
      detail: hasRunnableCard
        ? "You have a runnable card on the canvas."
        : "Select Start, then click Agent step. It will connect itself.",
      state: hasRunnableCard ? "done" : "current",
    },
    {
      id: "connect",
      title: "Keep every card connected",
      detail: startIsConnected
        ? "The flow has a path out of Start."
        : "Select Start before adding so the next card lands in the chain.",
      state: startIsConnected
        ? "done"
        : hasRunnableCard
          ? "current"
          : "blocked",
    },
    {
      id: "configure",
      title: selected ? `Configure ${selected}` : "Configure the selected card",
      detail: selected
        ? "Use the right panel. Labels, instructions, tools, and conditions save with this loop."
        : "Click any card to open its settings panel.",
      state: selected ? "current" : hasRunnableCard ? "current" : "blocked",
    },
    {
      id: "save",
      title: "Save when the badge is green",
      detail: isValid
        ? isDirty
          ? "Everything checks out. Save to keep these changes."
          : "Saved and valid. You can return to the loop and run it."
        : (helpfulError?.message ??
          "Fix the validation badge before saving this loop."),
      state: isValid ? "done" : hasEnd && hasStart ? "current" : "blocked",
    },
  ];

  if (!hasRunnableCard) {
    return {
      headline: "Build the loop one card at a time",
      detail:
        "The simple path is Start -> Agent step -> End. Select a card, then add the next card.",
      steps,
    };
  }

  if (!isValid) {
    return {
      headline: "One fix before this loop can run",
      detail:
        helpfulError?.message ??
        "Open the validation badge, choose the first item, and fix the highlighted card.",
      steps,
    };
  }

  if (isDirty) {
    return {
      headline: "This loop is ready to save",
      detail:
        "The graph is valid. Save now, then go back to the loop page to run it.",
      steps,
    };
  }

  return {
    headline: "All changes saved",
    detail:
      "This loop is saved and valid. Add more steps only when the process needs them.",
    steps,
  };
}
