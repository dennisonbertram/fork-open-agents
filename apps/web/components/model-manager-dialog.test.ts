import { describe, expect, test } from "bun:test";
import {
  MODEL_MANAGER_BULK_ACTION_LABELS,
  MODEL_MANAGER_DIALOG_CONTENT_CLASS_NAME,
  MODEL_MANAGER_DIALOG_LIST_CLASS_NAME,
  getModelManagerSelectionSummary,
  saveModelManagerSelection,
} from "./model-manager-dialog";

describe("ModelManagerDialog layout", () => {
  test("keeps the dialog viewport-bounded with an internal scroll list", () => {
    expect(MODEL_MANAGER_DIALOG_CONTENT_CLASS_NAME).toContain(
      "max-h-[min(680px,calc(100dvh-2rem))]",
    );
    expect(MODEL_MANAGER_DIALOG_CONTENT_CLASS_NAME).toContain(
      "grid-rows-[auto_auto_auto_minmax(0,1fr)_auto]",
    );
    expect(MODEL_MANAGER_DIALOG_CONTENT_CLASS_NAME).toContain(
      "overflow-hidden",
    );
    expect(MODEL_MANAGER_DIALOG_LIST_CLASS_NAME).toContain("min-h-0");
    expect(MODEL_MANAGER_DIALOG_LIST_CLASS_NAME).toContain("overflow-hidden");
  });

  test("describes empty selection as all models in the global picker", () => {
    expect(
      getModelManagerSelectionSummary({
        emptySelectionMode: "all",
        selectedCount: 0,
        totalCount: 12,
      }),
    ).toBe("Selector shows all 12 models");
  });

  test("describes empty selection as none in profile-scoped pickers", () => {
    expect(
      getModelManagerSelectionSummary({
        emptySelectionMode: "none",
        selectedCount: 0,
        totalCount: 12,
      }),
    ).toBe("No models selected");
  });

  test("keeps ambiguous recommended shortcut out of the footer actions", () => {
    expect(MODEL_MANAGER_BULK_ACTION_LABELS).toEqual([
      "Select all",
      "Clear all",
    ]);
    expect(MODEL_MANAGER_BULK_ACTION_LABELS).not.toContain("Recommended");
  });

  test("can close before a slow preference save resolves", async () => {
    const events: string[] = [];
    let resolveSave: (() => void) | undefined;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });

    const pending = saveModelManagerSelection({
      closeOnSaveStart: true,
      onOpenChange: (open) => events.push(`open:${open}`),
      onSave: async (enabledModelIds) => {
        events.push(`save:${enabledModelIds.join(",")}`);
        await savePromise;
      },
      selectedModelIds: ["model-a", "model-b"],
    });

    await Promise.resolve();

    expect(events).toEqual(["open:false", "save:model-a,model-b"]);

    resolveSave?.();
    await pending;

    expect(events).toEqual(["open:false", "save:model-a,model-b"]);
  });
});
