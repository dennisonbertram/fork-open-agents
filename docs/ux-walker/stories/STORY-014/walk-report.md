# STORY-014 Walk Report: User Creates And Manages A Skill

Walked: 2026-06-22
Target: `http://localhost:3002/settings/skills`
Browser: authenticated in-app browser tab
Status: pass after quick fixes

## Steps

1. Opened `/settings/skills`.
   - Result: Skills page rendered the empty state and New skill action.
   - Evidence: `snapshots/step-1-skills-empty-hydrated.txt`.
2. Opened New skill.
   - Result: dialog rendered AI generation, Name, Description, Instructions, invocation switches, Allowed tools, and Create skill.
   - Evidence: `snapshots/step-2-new-skill-dialog.txt`.
3. Entered `Bad Name!`.
   - Result: the field normalized to `bad-name` on blur and successfully created `/bad-name`.
   - Evidence: `snapshots/step-3b-after-invalid-attempt.txt`.
4. Tried to create a duplicate `/bad-name`.
   - Result: the dialog stayed open and showed `A skill named "bad-name" already exists.`
   - Evidence: `snapshots/step-4-duplicate-name-validation.txt`.
5. Applied quick fixes for skill action labels and inline delete confirmation.
   - Result: card actions became `Edit /bad-name`, `Delete /bad-name`, and `Disable /bad-name`.
   - Evidence: `snapshots/step-5-action-labels-after-fix.txt`.
6. Edited the temporary skill.
   - Result: skill updated to `/ux-walker-skill`, description updated, and `read_file, bash` produced a `2 tools` chip.
   - Evidence: `snapshots/step-6-edit-skill-dialog.txt` and `snapshots/step-7-edited-skill.txt`.
7. Disabled and re-enabled the skill.
   - Result: the switch changed between `Enable /ux-walker-skill` and `Disable /ux-walker-skill`.
   - Evidence: `snapshots/step-8-skill-disabled.txt` and `snapshots/step-9-skill-reenabled.txt`.
8. Verified the new inline delete confirmation.
   - Result: Delete showed inline Confirm and Cancel controls, Confirm removed the skill, and the empty state returned.
   - Evidence: `snapshots/step-11-delete-check-created.txt`, `snapshots/step-12-inline-delete-confirmation.txt`, and `snapshots/step-13-inline-delete-cleanup-empty.txt`.

## Findings

- `F-STORY-014-001`: Skill card edit/delete/toggle controls needed per-skill accessible labels.
- `F-STORY-014-002`: Skill deletion used a native browser confirmation instead of in-app Confirm/Cancel controls.

## Notes

The first temporary skill was removed directly from the app database after native confirmation blocked browser automation. After the inline delete quick fix, a second temporary skill was created and deleted through the UI, leaving the page back in the `No skills yet` empty state.
