"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
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

export function ContextPathCombobox({
  id,
  value,
  suggestions,
  onChange,
  placeholder = "Select or type a context path",
}: {
  id?: string;
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const options = useMemo(
    () => [...new Set(suggestions)].sort(),
    [suggestions],
  );
  const showTypedOption =
    search.trim().length > 0 && !options.includes(search.trim());

  useEffect(() => {
    if (open) setSearch(value);
    else setSearch("");
  }, [open, value]);

  function selectPath(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-expanded={open}
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-72 p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Search paths..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {showTypedOption
                ? "Press Enter to use this path."
                : "No matching paths found."}
            </CommandEmpty>
            {showTypedOption ? (
              <CommandGroup heading="Use this path">
                <CommandItem
                  value={search.trim()}
                  onSelect={() => selectPath(search.trim())}
                >
                  {search.trim()}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {options.length > 0 ? (
              <CommandGroup heading="Available paths">
                {options.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => selectPath(option)}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        value === option ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option}</span>
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
