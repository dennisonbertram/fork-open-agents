"use client";

/**
 * repo-combobox.tsx — a single "owner/repo" picker for the loop create form.
 *
 * Replaces two free-text "Repository owner" / "Repository name" inputs (which
 * required users to know GitHub's owner/repo split) with one combobox that:
 *   - autocompletes from repositories the user already has loops in
 *     (fetched from /api/agent-loops), and
 *   - always accepts a free-typed "owner/repo" for any other repository.
 */

import { useState } from "react";
import useSWR from "swr";
import { Check, ChevronsUpDown } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { ListAgentLoopsResponse } from "@/app/api/agent-loops/types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Request failed");
  }
  return res.json() as Promise<T>;
}

/** Parse "owner/repo" → {owner, name}, or null if it isn't a valid pair. */
export function parseRepoSlug(
  raw: string,
): { owner: string; name: string } | null {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const owner = trimmed.slice(0, slash).trim();
  const name = trimmed.slice(slash + 1).trim();
  if (!owner || !name || name.includes("/")) return null;
  return { owner, name };
}

type RepoComboboxProps = {
  owner: string;
  name: string;
  onChange: (owner: string, name: string) => void;
};

export function RepoCombobox({ owner, name, onChange }: RepoComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Suggestions: distinct repos from the user's existing loops.
  const { data } = useSWR<ListAgentLoopsResponse>(
    "/api/agent-loops",
    fetchJson,
  );
  const suggestions = Array.from(
    new Set((data?.loops ?? []).map((l) => `${l.repoOwner}/${l.repoName}`)),
  ).sort();

  const current = owner && name ? `${owner}/${name}` : "";
  const typed = parseRepoSlug(search);
  const showTypedOption =
    typed !== null && !suggestions.includes(`${typed.owner}/${typed.name}`);

  function select(slug: string) {
    const parsed = parseRepoSlug(slug);
    if (parsed) {
      onChange(parsed.owner, parsed.name);
      setOpen(false);
      setSearch("");
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn(!current && "text-muted-foreground")}>
            {current || "Select a repository (owner/repo)"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter>
          <CommandInput
            placeholder="Type owner/repo…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {showTypedOption ? (
              <CommandGroup heading="Use this repository">
                <CommandItem
                  value={`${typed.owner}/${typed.name}`}
                  onSelect={() => select(`${typed.owner}/${typed.name}`)}
                >
                  {typed.owner}/{typed.name}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {suggestions.length > 0 ? (
              <CommandGroup heading="Your repositories">
                {suggestions.map((slug) => (
                  <CommandItem
                    key={slug}
                    value={slug}
                    onSelect={() => select(slug)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        current === slug ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {slug}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandEmpty>
              Type a full <span className="font-mono">owner/repo</span> to use
              it.
            </CommandEmpty>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
