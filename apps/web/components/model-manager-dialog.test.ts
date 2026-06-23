import { describe, expect, test } from "bun:test";
import {
  MODEL_MANAGER_DIALOG_CONTENT_CLASS_NAME,
  MODEL_MANAGER_DIALOG_LIST_CLASS_NAME,
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
});
