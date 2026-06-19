"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown, ChevronRight, Maximize2, X } from "lucide-react";
import type { ToolkitSource } from "@/app/settings/composio-selectable-toolkits";
import { ComposioToolkitPicker } from "@/app/settings/composio-toolkit-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type InstructionsFieldConfig = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  help?: ReactNode;
  disabled?: boolean;
  rows?: number;
  textareaClassName?: string;
  expandedTextareaClassName?: string;
  expandedTitle: string;
  expandedDescription: ReactNode;
  expandedAriaLabel?: string;
};

type CheckCommandFieldConfig = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: ReactNode;
  disabled?: boolean;
};

type ToolsFieldConfig = {
  label: string;
  selectedSlugs: string[];
  onChange: (slugs: string[]) => void;
  help?: ReactNode;
  disabled?: boolean;
  source?: ToolkitSource;
  connectHint?: string;
};

type GitHubPermissionsFieldConfig = {
  githubToolsEnabled: boolean;
  onGithubToolsEnabledChange: (enabled: boolean) => void;
  toolAuthoringEnabled: boolean;
  onToolAuthoringEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
};

type DeclaredOutputsFieldConfig = {
  outputSchema?: Record<string, unknown>;
  onOutputSchemaChange: (
    outputSchema: Record<string, unknown> | undefined,
  ) => void;
  contextPathPrefix: string;
  disabled?: boolean;
};

export type AgentConfigFieldsProps = {
  instructions: InstructionsFieldConfig;
  tools: ToolsFieldConfig;
  checkCommand?: CheckCommandFieldConfig;
  githubPermissions?: GitHubPermissionsFieldConfig;
  declaredOutputs?: DeclaredOutputsFieldConfig;
  errors?: string[];
  className?: string;
};

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs">
      {children}
    </Label>
  );
}

function FieldHelp({ children }: { children: ReactNode }) {
  return (
    <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
      {children}
    </p>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400 leading-snug">
      {message}
    </p>
  );
}

function InstructionsField({ config }: { config: InstructionsFieldConfig }) {
  const [expanded, setExpanded] = useState(false);
  const ariaLabel = config.expandedAriaLabel ?? "Instructions expanded editor";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={config.id}>Instructions</FieldLabel>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(true)}
          disabled={config.disabled}
          className="h-auto gap-1 px-1.5 py-0 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Maximize2 className="h-3 w-3" />
          Expand
        </Button>
      </div>
      <Textarea
        id={config.id}
        className={config.textareaClassName}
        value={config.value}
        onChange={(event) => config.onChange(event.target.value)}
        placeholder={config.placeholder}
        rows={config.rows}
        disabled={config.disabled}
      />
      {config.help ? <FieldHelp>{config.help}</FieldHelp> : null}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{config.expandedTitle}</DialogTitle>
            <DialogDescription>{config.expandedDescription}</DialogDescription>
          </DialogHeader>
          <Textarea
            // biome-ignore lint/a11y/noAutofocus: focusing the editor is the point of expanding
            autoFocus
            className={cn(
              config.textareaClassName,
              config.expandedTextareaClassName,
              "min-h-[50vh] flex-1 resize-none",
            )}
            value={config.value}
            onChange={(event) => config.onChange(event.target.value)}
            placeholder={config.placeholder}
            disabled={config.disabled}
            aria-label={ariaLabel}
          />
          <DialogFooter>
            <Button type="button" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CheckCommandField({ config }: { config: CheckCommandFieldConfig }) {
  return (
    <div className="space-y-1">
      <FieldLabel htmlFor={config.id}>Check command</FieldLabel>
      <Input
        id={config.id}
        type="text"
        className="font-mono"
        value={config.value}
        onChange={(event) => config.onChange(event.target.value)}
        placeholder={config.placeholder}
        disabled={config.disabled}
      />
      {config.help ? <FieldHelp>{config.help}</FieldHelp> : null}
    </div>
  );
}

function ToolsField({ config }: { config: ToolsFieldConfig }) {
  const handleChange = config.onChange;

  return (
    <div className="space-y-1">
      <FieldLabel>{config.label}</FieldLabel>
      <ComposioToolkitPicker
        selectedSlugs={config.selectedSlugs}
        onChange={handleChange}
        disabled={config.disabled}
        source={config.source}
        connectHint={config.connectHint}
      />
      {config.help ? <FieldHelp>{config.help}</FieldHelp> : null}
    </div>
  );
}

function GitHubPermissionsField({
  config,
}: {
  config: GitHubPermissionsFieldConfig;
}) {
  const handleGithubToolsEnabledChange = config.onGithubToolsEnabledChange;
  const handleToolAuthoringEnabledChange = config.onToolAuthoringEnabledChange;

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="agent-github-tools-enabled">GitHub tools</Label>
          <p className="text-xs text-muted-foreground">
            Let this agent read and act on GitHub issues, branches, and PRs for
            repos you have access to.
          </p>
        </div>
        <Switch
          id="agent-github-tools-enabled"
          checked={config.githubToolsEnabled}
          onCheckedChange={handleGithubToolsEnabledChange}
          disabled={config.disabled}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="agent-tool-authoring-enabled">Tool authoring</Label>
          <p className="text-xs text-muted-foreground">
            Let this agent propose new Composio tools. Proposals are recorded
            for review and do not auto-enable tools.
          </p>
        </div>
        <Switch
          id="agent-tool-authoring-enabled"
          checked={config.toolAuthoringEnabled}
          onCheckedChange={handleToolAuthoringEnabledChange}
          disabled={config.disabled}
        />
      </div>
    </>
  );
}

function DeclaredOutputsField({
  config,
}: {
  config: DeclaredOutputsFieldConfig;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [newOutputName, setNewOutputName] = useState("");
  const [newOutputType, setNewOutputType] = useState("string");
  const outputFields = Object.entries(config.outputSchema ?? {});

  function addOutputField() {
    const name = newOutputName.trim();
    if (!name) return;
    config.onOutputSchemaChange({
      ...config.outputSchema,
      [name]: newOutputType,
    });
    setNewOutputName("");
    setNewOutputType("string");
  }

  function removeOutputField(name: string) {
    const next = { ...config.outputSchema };
    delete next[name];
    config.onOutputSchemaChange(
      Object.keys(next).length > 0 ? next : undefined,
    );
  }

  function handleOutputSchemaChange(raw: string) {
    if (raw.trim() === "") {
      setJsonError(null);
      config.onOutputSchemaChange(undefined);
      return;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setJsonError("Must be a JSON object (not an array or primitive).");
        return;
      }
      setJsonError(null);
      config.onOutputSchemaChange(parsed as Record<string, unknown>);
    } catch {
      setJsonError("Invalid JSON.");
    }
  }

  return (
    <div className="space-y-1">
      <FieldLabel>Outputs</FieldLabel>
      {outputFields.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {outputFields.map(([name]) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-700 dark:text-violet-300"
            >
              {name}
              <button
                type="button"
                onClick={() => removeOutputField(name)}
                className="hover:text-foreground"
                aria-label={`Remove output ${name}`}
                disabled={config.disabled}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1.5">
        <Input
          type="text"
          value={newOutputName}
          onChange={(event) => setNewOutputName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addOutputField();
            }
          }}
          placeholder="field name (e.g. passed)"
          className="min-w-0 flex-1 font-mono"
          aria-label="Output field name"
          disabled={config.disabled}
        />
        <Select
          value={newOutputType}
          onValueChange={setNewOutputType}
          disabled={config.disabled}
        >
          <SelectTrigger className="w-[7.5rem]" aria-label="Output field type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="string">string</SelectItem>
            <SelectItem value="boolean">boolean</SelectItem>
            <SelectItem value="number">number</SelectItem>
            <SelectItem value="array">array</SelectItem>
            <SelectItem value="object">object</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addOutputField}
          disabled={config.disabled}
        >
          Add
        </Button>
      </div>
      <FieldHelp>
        Fields this step writes to{" "}
        <code className="font-mono text-[10px]">
          /tmp/loop-step-output.json
        </code>
        . Downstream nodes read them as{" "}
        <code className="font-mono text-[10px]">
          {config.contextPathPrefix}.&lt;field&gt;
        </code>
        .
      </FieldHelp>

      <div className="space-y-1">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setAdvancedOpen((value) => !value)}
          disabled={config.disabled}
        >
          {advancedOpen ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          Advanced
        </button>

        {advancedOpen ? (
          <div className="space-y-1 pl-5">
            <FieldLabel htmlFor="output-schema">
              Output schema (JSON)
            </FieldLabel>
            <Textarea
              id="output-schema"
              className={cn(
                "min-h-[80px] resize-y font-mono text-xs",
                jsonError ? "border-destructive" : undefined,
              )}
              aria-invalid={jsonError ? true : undefined}
              defaultValue={
                config.outputSchema
                  ? JSON.stringify(config.outputSchema, null, 2)
                  : ""
              }
              onBlur={(event) => handleOutputSchemaChange(event.target.value)}
              placeholder='{ "type": "object", "properties": { ... } }'
              disabled={config.disabled}
            />
            {jsonError ? (
              <FieldError message={jsonError} />
            ) : (
              <FieldHelp>
                JSON Schema lite object. Validates the JSON your agent writes to
                /tmp/loop-step-output.json.
              </FieldHelp>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AgentConfigFields({
  instructions,
  tools,
  checkCommand,
  githubPermissions,
  declaredOutputs,
  errors = [],
  className,
}: AgentConfigFieldsProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <InstructionsField config={instructions} />
      {checkCommand ? <CheckCommandField config={checkCommand} /> : null}
      <ToolsField config={tools} />
      {githubPermissions ? (
        <GitHubPermissionsField config={githubPermissions} />
      ) : null}
      {declaredOutputs ? (
        <DeclaredOutputsField config={declaredOutputs} />
      ) : null}
      {errors.length > 0 ? (
        <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950/20">
          {errors.map((message, index) => (
            <p
              key={`${message}-${index}`}
              className="text-[11px] text-red-600 dark:text-red-400"
            >
              {message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
