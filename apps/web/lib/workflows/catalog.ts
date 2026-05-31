// Stub — implementation pending (exists only to resolve import so tests fail meaningfully)

export const SUPPORTED_PROOF_LEVELS = [] as const;
export type ProofLevel = never;

export type WorkflowDefinition = {
  id: string;
  version: string;
  name: string;
  description: string;
  capabilities: string[];
  proofLevel: ProofLevel;
  enabled: boolean;
  inputSchemaRef?: string;
};

export type WorkflowRegistry = never;

export class WorkflowCatalogError extends Error {
  kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
  }
}

export function buildRegistry(_definitions: WorkflowDefinition[]): never {
  throw new Error("NOT IMPLEMENTED");
}

export function lookupWorkflow(
  _registry: never,
  _id: string,
): WorkflowDefinition | undefined {
  throw new Error("NOT IMPLEMENTED");
}

export function listWorkflows(
  _registry: never,
  _options?: { enabledOnly?: boolean },
): WorkflowDefinition[] {
  throw new Error("NOT IMPLEMENTED");
}

export const DEFAULT_CATALOG: WorkflowDefinition[] = [];
