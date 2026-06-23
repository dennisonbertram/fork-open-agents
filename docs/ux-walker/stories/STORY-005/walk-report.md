# STORY-005 Walk Report: User Sends A First Chat Message And Adjusts Chat Controls

Walked: 2026-06-21
Target: `http://localhost:3002/sessions/1Q5F4CqxTRVvUJVYidMW6/chats/pmiFO7xOTZehzEFgTy7dW`
Browser: authenticated in-app browser tab
Status: pass after quick fix

## Steps

1. Started from a fresh repo-backed chat.
   - Result: composer was active, GitHub native tools were visible, runtime was Direct, and the send button was disabled until text was entered.
   - Evidence: `snapshots/step-1-chat-start.txt`.
2. Opened the model selector.
   - Result: models were grouped by provider. Fireworks appeared as its own provider group and included GLM 5.2.
   - Evidence: `snapshots/step-2-model-selector.txt`.
3. Opened external tools.
   - Result: GitHub appeared under native connections and was marked always on for the repo; Composio profile choices remained available below.
   - Evidence: `snapshots/step-3-tools-picker.txt`.
4. Opened runtime selection.
   - Result: Direct and Coordinated modes had explanatory copy, and the active managed profile was visible.
   - Evidence: `snapshots/step-4-runtime-selector.txt`.
5. Opened workflow selection.
   - Result: workflow options were visible but disabled in this state.
   - Evidence: `snapshots/step-5-workflow-selector.txt`.
6. Typed and submitted a first prompt.
   - Result: Enter submitted successfully, the user message appeared, controls disabled during thinking, and response metadata showed elapsed time, tool calls, tokens/sec, and cost.
   - Evidence: `snapshots/step-6-composer-filled.txt`, `snapshots/step-8-message-submit-retry.txt`, and `snapshots/step-9-response-after-wait.txt`.
7. Observed connected-repo answer.
   - Initial result: assistant answered `Repo: sandbox` despite the chat header showing `dennisonbertram/synthetix`.
   - Evidence: `snapshots/step-9-response-after-wait.txt`.
8. Applied quick fix and re-asked for the repo/branch.
   - Result: assistant answered `dennisonbertram/synthetix — d/881fa842` with no console errors.
   - Evidence: `snapshots/step-10-repo-context-after-fix.txt` and `snapshots/step-10-repo-context-after-fix-errors.json`.

## Findings

- `F-STORY-005-001`: Agent prompt context did not identify the connected repository separately from the sandbox workspace directory, so the model inferred `sandbox` as the repo name. Fixed by passing repo owner/name into the agent context and prompt.
