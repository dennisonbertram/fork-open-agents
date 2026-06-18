# Column-type heuristics

This file is intentionally kept out of the system prompt and out of the loaded
skill body. It represents "level 3" of progressive disclosure: the agent reads
it on demand (via the `read` tool) only when it needs the detail.

## How `summarize.ts` decides a column is numeric

A column is treated as numeric only when **every** non-empty cell parses to a
finite number (`Number.isFinite`). If any cell is non-numeric (e.g. a stray
label, a `N/A`, or a thousands separator like `1,000`), the whole column is
skipped rather than partially summarized.

## Handling a misclassified column

- A numeric column dropped because of `N/A` cells: clean the source data, or
  extend the script to coerce known sentinels to empty before parsing.
- A column with embedded commas (`1,000`): the naive `split(",")` parser will
  mis-split it. Quote-aware parsing is out of scope for this proof of concept.
