"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGitHubConnectionStatus } from "@/hooks/use-github-connection-status";
import { useGitHubRepositoryOptions } from "@/hooks/use-github-repository-options";
import { useSession } from "@/hooks/use-session";
import { buildGitHubReconnectUrl } from "@/lib/github/urls";
import { cn } from "@/lib/utils";

export type GitHubRepositoryValue = {
  owner: string;
  name: string;
};

export function parseGitHubRepositorySlug(
  value: string,
): GitHubRepositoryValue | null {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  const separator = normalized.indexOf("/");
  if (separator <= 0 || separator === normalized.length - 1) return null;

  const owner = normalized.slice(0, separator).trim();
  const name = normalized.slice(separator + 1).trim();
  return owner && name && !name.includes("/") ? { owner, name } : null;
}

export function GitHubRepositoryCombobox({
  value,
  onChange,
  disabled = false,
  allowFreeform = false,
  placeholder = "Select a repository",
}: {
  value: GitHubRepositoryValue;
  onChange: (value: GitHubRepositoryValue) => void;
  disabled?: boolean;
  allowFreeform?: boolean;
  placeholder?: string;
}) {
  const { hasGitHub } = useSession();
  const { reconnectRequired } = useGitHubConnectionStatus({
    enabled: hasGitHub,
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const { options, isLoading, error, refresh } = useGitHubRepositoryOptions({
    enabled: hasGitHub && !reconnectRequired,
    query: deferredSearch,
  });

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const typedRepository = parseGitHubRepositorySlug(search);
  const hasTypedRepository =
    allowFreeform &&
    typedRepository !== null &&
    !options.some((option) => option.fullName === search.trim());
  const selectedRepository =
    value.owner && value.name ? `${value.owner}/${value.name}` : "";

  function startGitHubConnection() {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.href = reconnectRequired
      ? buildGitHubReconnectUrl(next)
      : `/api/github/app/install?next=${encodeURIComponent(next)}`;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-expanded={open}
          className="w-full justify-between"
        >
          <span
            className={cn(
              "min-w-0 truncate text-left",
              !selectedRepository && "text-muted-foreground",
            )}
          >
            {selectedRepository || placeholder}
          </span>
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-80 p-0"
        align="start"
      >
        <Command shouldFilter>
          <CommandInput
            placeholder="Search repositories or owner/repo..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? (
                "Loading repositories..."
              ) : error ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <span>Could not load connected repositories.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void refresh()}
                  >
                    <RefreshCwIcon className="size-3.5" />
                    Retry
                  </Button>
                </div>
              ) : !hasGitHub || reconnectRequired ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <span>Connect GitHub to search repositories.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={startGitHubConnection}
                  >
                    {reconnectRequired ? "Reconnect GitHub" : "Connect GitHub"}
                  </Button>
                </div>
              ) : (
                "No matching repositories found."
              )}
            </CommandEmpty>
            {hasTypedRepository && typedRepository ? (
              <CommandGroup heading="Use this repository">
                <CommandItem
                  value={`${typedRepository.owner}/${typedRepository.name}`}
                  onSelect={() => {
                    onChange(typedRepository);
                    setOpen(false);
                  }}
                >
                  {typedRepository.owner}/{typedRepository.name}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {options.length > 0 ? (
              <CommandGroup heading="Connected repositories">
                {options.map((option) => (
                  <CommandItem
                    key={option.fullName}
                    value={`${option.fullName} ${option.description ?? ""}`}
                    onSelect={() => {
                      onChange({ owner: option.owner, name: option.name });
                      setOpen(false);
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        selectedRepository === option.fullName
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 truncate">{option.fullName}</span>
                    {option.private ? (
                      <span className="ml-auto text-xs text-muted-foreground">
                        private
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
