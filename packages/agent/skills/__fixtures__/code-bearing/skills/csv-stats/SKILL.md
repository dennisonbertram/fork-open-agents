---
name: csv-stats
description: Summarize a CSV file — row count plus per-column numeric stats (mean, min, max). Use when the user asks to analyze, summarize, or compute statistics about a CSV or tabular data file.
version: 0.1.0
allowed-tools: bash, read
---

# CSV Stats

Compute summary statistics for a CSV file by **running the bundled script**
instead of reading the file into context. The script is deterministic and
handles files far larger than the model should parse by hand. Only the script's
output enters the conversation — the file contents and the script code do not.

## Steps

1. The first line of this message is `Skill directory: <abs path>`. Use that
   absolute path to locate the bundled script.

2. Run the bundled script against the target file. The target path was passed as
   the skill argument and is substituted here: `$ARGUMENTS`

   ```bash
   bun "<skill-dir>/scripts/summarize.ts" "$ARGUMENTS"
   ```

   Invoking via the `bun` interpreter explicitly avoids depending on the
   script's execute bit or shebang. (Real skills can bundle Python or shell
   scripts the same way — `python "<skill-dir>/foo.py"`, `bash
   "<skill-dir>/foo.sh"` — the mechanism is identical: the script lives in the
   skill directory and runs via bash.)

3. Report the JSON the script prints: the row count and, for each numeric
   column, the mean, min, and max.

## Reference

For how numeric columns are detected (and how to handle a misclassified
column), see `references/heuristics.md`. Only read it if a column looks wrong —
it is intentionally kept out of context until needed (level-3 progressive
disclosure).
