# STORY-011 Walk Report: User Creates A Model Variant

Walked: 2026-06-22
Target: `http://localhost:3002/settings/models`
Browser: authenticated in-app browser tab
Status: pass after quick fix

## Steps

1. Opened `/settings/models`.
   - Result: Model preferences, Inference Profiles, and Model Variants rendered. Built-in variants were visible and marked `Built-in`.
   - Evidence: `snapshots/step-1-settings-models.txt`.
2. Opened `New Variant`.
   - Result: dialog rendered Name, Base Model, Provider Options, docs link, Cancel, and Create Variant.
   - Evidence: `snapshots/step-2-new-variant-dialog.txt`.
3. Entered invalid provider options JSON.
   - Result: dialog stayed open and showed `Provider options must be valid JSON`.
   - Evidence: `snapshots/step-3-invalid-json.txt`.
4. Created a temporary valid variant.
   - Result: `UX Walker Temp Variant` appeared in the list with base model `Qwen3-14B` and option `temperature`.
   - Evidence: `snapshots/step-4-created-variant.txt` and `snapshots/step-5-created-dialog-still-open.txt`.
5. Applied quick fix for variant action labels.
   - Result: the temp variant's action buttons became `Edit UX Walker Temp Variant` and `Delete UX Walker Temp Variant`.
   - Evidence: `snapshots/step-6-action-label-fix.txt`.
6. Edited the temporary variant.
   - Result: variant updated to `UX Walker Temp Variant Edited` with `temperature` and `topP` options, and the action labels updated with the new name.
   - Evidence: `snapshots/step-7-edited-variant.txt`.
7. Deleted the temporary variant.
   - Result: browser automation wedged around the native delete confirmation, so cleanup was completed and verified through the app database. No `UX Walker Temp Variant` entries remain.
   - Evidence: `snapshots/step-8-cleanup-verified.txt`.

## Findings

- `F-STORY-011-001`: User-created variant edit/delete controls needed explicit accessible labels.

## Notes

The create dialog appeared in the same snapshot as the newly created variant immediately after save, but a follow-up wait showed the dialog closed and the variant remained in the list. The temporary variant was removed at the end of the walk.
