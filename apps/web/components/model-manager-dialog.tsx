"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";
import {
  RECOMMENDED_MODEL_IDS,
  type ModelOption,
  type ModelSortKey,
  type ModelSourceFilter,
  filterAndSortModelOptions,
} from "@/lib/model-options";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ProviderIcon,
  getProviderDisplayName,
} from "@/components/provider-icons";

interface ModelManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelOptions: ModelOption[];
  /** Current enabled model IDs (empty = show all). */
  enabledModelIds: string[];
  /** Called with the new complete list of enabled IDs when the user saves. */
  onSave: (enabledModelIds: string[]) => Promise<void>;
}

/** Derive a deduplicated sorted list of provider keys from the given options. */
function deriveProviders(options: ModelOption[]): string[] {
  const seen = new Set<string>();
  for (const o of options) {
    seen.add(o.provider);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function ModelManagerDialog({
  open,
  onOpenChange,
  modelOptions,
  enabledModelIds,
  onSave,
}: ModelManagerDialogProps) {
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [sort, setSort] = useState<ModelSortKey>("name");
  const [source, setSource] = useState<ModelSourceFilter>("all");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(enabledModelIds),
  );
  const [saving, setSaving] = useState(false);

  // Reset local selection when dialog opens with latest enabledModelIds
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setSelected(new Set(enabledModelIds));
        setSearch("");
        setProviderFilter("all");
        setSort("name");
        setSource("all");
        setSelectedOnly(false);
      }
      onOpenChange(next);
    },
    [enabledModelIds, onOpenChange],
  );

  const providers = useMemo(
    () => deriveProviders(modelOptions),
    [modelOptions],
  );

  const hasUserModels = useMemo(
    () => modelOptions.some((o) => o.source === "user"),
    [modelOptions],
  );

  const visible = useMemo(
    () =>
      filterAndSortModelOptions(modelOptions, {
        providerFilter,
        sort,
        search,
        source,
        selectedOnly,
        selectedIds: selected,
      }),
    [
      modelOptions,
      providerFilter,
      sort,
      search,
      source,
      selectedOnly,
      selected,
    ],
  );

  const toggleModel = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(Array.from(selected));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [onSave, onOpenChange, selected]);

  const handleClearAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(modelOptions.map((o) => o.id)));
  }, [modelOptions]);

  const handleRecommended = useCallback(() => {
    // Intersect with the live catalog so we never select IDs that aren&apos;t present
    const catalogIds = new Set(modelOptions.map((o) => o.id));
    const liveRecommended = (RECOMMENDED_MODEL_IDS as readonly string[]).filter(
      (id) => catalogIds.has(id),
    );
    setSelected(new Set(liveRecommended));
  }, [modelOptions]);

  const selectedCount = selected.size;
  const totalCount = modelOptions.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm font-semibold">
            Manage models
          </DialogTitle>
        </DialogHeader>

        {/* Filters row */}
        <div className="flex items-center gap-2 border-b px-4 py-2">
          {/* Search */}
          <div className="relative flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              aria-label="Search models"
              placeholder="Search models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-md border bg-transparent py-1 pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>

          {/* Provider filter */}
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger
              size="sm"
              aria-label="Filter by provider"
              className="w-[130px]"
            >
              <SelectValue placeholder="All providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p} value={p}>
                  {getProviderDisplayName(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select
            value={sort}
            onValueChange={(v) => setSort(v as ModelSortKey)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Sort order"
              className="w-[110px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name A–Z</SelectItem>
              <SelectItem value="provider">Provider</SelectItem>
              <SelectItem value="cost-asc">Cost ↑</SelectItem>
              <SelectItem value="cost-desc">Cost ↓</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Facets row: source segmented control, selected-only toggle, count */}
        <div className="flex items-center gap-2 border-b px-4 py-2">
          {hasUserModels && (
            <div
              className="flex items-center rounded-md border p-0.5"
              role="group"
              aria-label="Filter by source"
            >
              {(
                [
                  { key: "all", label: "All" },
                  { key: "catalog", label: "Catalog" },
                  { key: "user", label: "Your keys" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={source === opt.key}
                  onClick={() => setSource(opt.key)}
                  className={cn(
                    "rounded px-2 py-1 text-xs transition-colors",
                    source === opt.key
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            aria-pressed={selectedOnly}
            onClick={() => setSelectedOnly((prev) => !prev)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-colors",
              selectedOnly
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Selected only
          </button>

          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {visible.length === modelOptions.length
              ? `${modelOptions.length} models`
              : `${visible.length} of ${modelOptions.length}`}
          </span>
        </div>

        {/* Model list */}
        <ScrollArea className="min-h-0 flex-1">
          <ul className="divide-y">
            {visible.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No models match your filters.
              </li>
            )}
            {visible.map((option) => {
              const isEnabled = selected.has(option.id);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => toggleModel(option.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/50"
                  >
                    {/* Checkbox indicator */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        isEnabled
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {isEnabled && <CheckIcon className="size-3" />}
                    </span>

                    {option.source === "user" ? (
                      <span
                        className="flex size-3.5 shrink-0 items-center justify-center"
                        title="Uses your personal provider key"
                      >
                        <span
                          aria-label="Your personal provider key"
                          className="size-2 rounded-full bg-emerald-500"
                        />
                      </span>
                    ) : (
                      <ProviderIcon
                        provider={option.provider}
                        className="size-3.5 shrink-0 opacity-70"
                      />
                    )}

                    <span className="min-w-0 flex-1 truncate">
                      {option.shortLabel}
                      {option.secondaryLabel && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          via {option.secondaryLabel}
                        </span>
                      )}
                    </span>

                    <span className="shrink-0 text-xs text-muted-foreground">
                      {option.source === "user"
                        ? "Your key"
                        : getProviderDisplayName(option.provider)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRecommended}
              className="text-xs text-muted-foreground hover:text-foreground"
              title="Reset to the curated Recommended shortlist"
            >
              Recommended
            </button>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {selectedCount === 0
                ? `Selector shows all ${totalCount} models`
                : `Selector shows your ${selectedCount} models`}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
