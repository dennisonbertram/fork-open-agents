import { describe, expect, test } from "bun:test";

import { parseWorkflowDispatchConfig } from "./workflows";

describe("actions-manager workflow metadata", () => {
  test("parses workflow_dispatch inputs from a workflow file", () => {
    const config = parseWorkflowDispatchConfig(`
name: Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
        required: true
        default: dev
        type: choice
        options:
          - dev
          - staging
      dry_run:
        description: Skip deploy writes
        type: boolean
        default: "false"
`);

    expect(config).toMatchObject({
      enabled: true,
      inputs: [
        {
          name: "environment",
          description: "Target environment",
          required: true,
          default: "dev",
          type: "choice",
          options: ["dev", "staging"],
        },
        {
          name: "dry_run",
          description: "Skip deploy writes",
          required: false,
          default: "false",
          type: "boolean",
        },
      ],
    });
  });

  test("returns null when workflow_dispatch is absent", () => {
    expect(
      parseWorkflowDispatchConfig(`
name: CI
on:
  push:
    branches: [develop]
`),
    ).toBeNull();
  });
});
