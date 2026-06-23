# STORY-010 Walk Report: User Configures Model Preferences And Inference Profiles

Walked: 2026-06-21
Target: `http://localhost:3002/settings/models`
Browser: authenticated in-app browser tab
Status: pass after quick fix

## Steps

1. Opened `/settings/models`.
   - Result: page rendered Model preferences, Inference Profiles, and Model Variants.
2. Opened “New Profile”.
   - Result: dialog rendered Provider type, Name, Base URL, API Key, Enabled, Cancel, and Create.
3. Attempted to reach the Cursor setup path.
   - Initial result: Cursor preset was only visible after switching the Provider type to OpenAI-compatible. The provider select was brittle in the active browser QA environment, so the fastest path to Cursor support was hidden behind the one control most likely to fail.
4. Applied quick fix.
   - Result: “Cursor Composer preset” and “Use Cursor” are now visible immediately in the dialog.
5. Clicked “Use Cursor”.
   - Result: Name became `Cursor`, Base URL became `http://127.0.0.1:8787/v1`, provider state became OpenAI-compatible, the Model IDs field appeared, and it contained `composer-2.5` plus `composer-2.5-fast`.
6. Checked console errors.
   - Result: no browser console errors were recorded.

## Findings

- `F-STORY-010-001`: Cursor Composer setup was hidden behind the provider dropdown, making the intended shortcut hard to discover and fragile during the UX walk.
