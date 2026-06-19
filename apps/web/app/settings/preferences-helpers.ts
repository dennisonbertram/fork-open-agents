/**
 * Pure helper: returns true when a Select has ≤1 real option and should be
 * replaced with a static read-only line.
 */
export function shouldCollapseSingleOption(
  options: Array<{ id: string; name: string }>,
): boolean {
  return options.length <= 1;
}

export function getSingleOptionPickerState(
  options: Array<{ id: string; name: string }>,
): { label: string; status: string } | null {
  if (!shouldCollapseSingleOption(options)) {
    return null;
  }

  const option = options[0];

  return {
    label: option?.name ?? "None",
    status: option ? "Only available option" : "No options available",
  };
}
