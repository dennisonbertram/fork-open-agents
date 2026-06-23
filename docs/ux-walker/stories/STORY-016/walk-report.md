# STORY-016 Walk Report: User Builds And Runs A Loop

Walked: 2026-06-22
Target: `http://localhost:3002/loops`
Browser: authenticated in-app browser tab
Status: pass

## Steps

1. Opened `/loops`.
   - Result: page rendered existing loops, repo-scoped loop links, and a clear New loop entry point.
   - Evidence: `snapshots/step-1-loops-page.txt`.
2. Opened `/loops/new`.
   - Result: page offered Templates, Describe with AI, and Blank creation paths. Template cards rendered working graph previews.
   - Evidence: `snapshots/step-2-new-loop-page.txt`.
3. Applied quick fix for repeated template action labels.
   - Result: visible template actions now expose names such as `Use Review to issues template` and `Use Backlog -> PR template`.
   - Evidence: `snapshots/step-3-template-labels-after-fix.txt`.
4. Chose the Review to issues template.
   - Result: page showed a prefilled create form with loop name, repository selector, description, and advanced JSON definition editor.
   - Evidence: `snapshots/step-4-template-configure-form.txt`.
5. Selected `dennisonbertram/synthetix`.
   - Result: repository picker selected the connected repo and the form became ready to create.
   - Evidence: `snapshots/step-5-repository-picker.txt`, `snapshots/step-6-repository-selected.txt`, `snapshots/step-7-ready-to-create.txt`.
6. Created the loop and landed in the builder.
   - Result: builder rendered node palette, graph nodes, edge labels, zoom controls, settings button, and back link.
   - Evidence: `snapshots/step-8-builder-after-create-wait.txt`.
7. Added an Agent step and Condition.
   - Result: builder added both nodes and surfaced a `3 errors` indicator.
   - Evidence: `snapshots/step-9-builder-add-agent-condition.txt`.
8. Opened the builder error summary.
   - Result: errors named the condition node and explained missing outgoing, true, and false edges.
   - Evidence: `snapshots/step-10-builder-error-summary.txt`.
9. Seeded local run states for the temporary loop rather than starting the GitHub-mutating template runner.
   - Result: running run rendered Pause and Cancel run; Pause transitioned to Resume; Resume returned to Pause; Cancel opened a confirmation dialog and then moved the run to a terminal state with Retry visible.
   - Evidence: `snapshots/step-11-running-run-actions.txt`, `snapshots/step-12-after-pause-action-refreshed.txt`, `snapshots/step-13-after-resume-action.txt`, `snapshots/step-14-cancel-confirmation-dialog.txt`, `snapshots/step-15-after-cancel-action.txt`.
10. Opened a seeded failed run.
    - Result: failed run rendered the Retry action and run graph without requiring a live agent dispatch.
    - Evidence: `snapshots/step-16-failed-run-retry-action.txt`.
11. Checked browser logs and cleaned up the temporary loop.
    - Result: log buffer contained expected development/HMR analytics noise from the long live-edit session and no fresh story-specific exception. Temporary loop `kkW59lbrSEtHU80w-oS0O` was deleted from the local database.
    - Evidence: `snapshots/step-17-browser-logs.json`.

## Findings

- `F-STORY-016-001`: Loop template actions used identical visible labels and needed target-specific accessible names.

## Notes

The live Run now button was not clicked on the Review to issues template because that template can file GitHub issues. Local run rows were seeded against the temporary loop to verify the run-detail lifecycle controls without dispatching agent work or mutating GitHub.
