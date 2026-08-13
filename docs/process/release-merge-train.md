# Release Merge Train

How `develop` and `main` stay mergeable, and the rule that keeps them that way.

## The failure this prevents

A release PR (`develop` → `main`) reports `BEHIND` and refuses to merge, even
with every check green. Unblocking it costs an extra PR cycle, and the block is
usually discovered at the worst moment: after the work is done and reviewed.

## Cause

Two facts combine.

1. Branch protection on `main` and `develop` requires a branch to be up to date
   before it merges (GitHub calls this "strict" required status checks). A
   branch that is even one commit behind its base is refused.
2. Merging a release PR creates a merge commit **on `main` only**. `develop`
   does not have it.

So the moment a release lands, `main` is one commit ahead of `develop`, and the
next release PR is `BEHIND` before anyone writes a line of code. Any commit
merged straight to `main` — a docs PR, a hotfix — widens the same gap.

The gap cannot be closed with GitHub's "Update branch" button, because
`develop` is itself protected:

```
422 protected branch 'develop' check failed:
  Changes must be made through a pull request.
```

Every unblock therefore costs a full backmerge PR: branch off `develop`, merge
`main` into it, push, open, wait for CI, merge.

## The rules

**1. Backmerge immediately after every release.** Treat it as the last step of
releasing, not as a repair. The PR is identical either way; done straight after
the release it blocks nothing, and discovered later it blocks the next release.

```bash
git fetch origin main develop
git checkout -b chore/backmerge-main-$(date +%Y-%m-%d) origin/develop
git merge --no-edit origin/main
git push -u origin HEAD
gh pr create --base develop --title "chore: merge main into develop after the release"
```

A release is not finished until this PR is merged.

**2. Nothing merges directly to `main` except a release PR.** Docs, chores and
hotfixes all land on `develop` first. Direct-to-`main` commits are the largest
source of drift — one batch of docs PRs put `main` four commits ahead and
stalled an unrelated release.

If a hotfix genuinely cannot wait for the train, merge it to `main`, then
backmerge in the same sitting under rule 1.

**3. Keep the strict check on `main`.** It is what makes "green means green"
true for production: the checks ran against the exact tree being deployed.

Turning the same check off on **`develop`** is a defensible trade, and is the
cheapest structural fix if backmerges become frequent: required checks still
run on every PR, and a release PR re-tests the integrated tree immediately
afterwards. What you lose is the guarantee that `develop`'s CI ran against the
exact merged result. That guarantee is worth much less on an integration branch
than on the branch that ships. **This is not the current setting** — changing it
is an operator decision, not something to do mid-task.

**4. Fast-forward releases remove the problem entirely.** If `main` only ever
fast-forwards to a commit that already exists on `develop`, no merge commit is
created, no drift appears, and no backmerge is needed. This is a change to how
releases are performed, not a setting, so it belongs in a deliberate change —
noted here as the structural end state, not an in-flight fix.

## Automating rule 1

Rule 1 is mechanical and is a good candidate for a GitHub Action on push to
`main`: open (or update) a backmerge PR automatically. Until that exists, the
rule stands as a manual reflex, and an agent finishing a release performs it
without being asked.

## Diagnosing a blocked PR

`mergeStateStatus` from `gh pr view <n> --json mergeStateStatus` names the
cause, and the three values seen here mean different things:

| Value | Meaning | Fix |
| --- | --- | --- |
| `BEHIND` | base has commits this branch lacks | backmerge (rule 1) |
| `BLOCKED` | a required check missing, or an **unresolved review thread** | read `reviewThreads`; resolve or fix |
| `UNSTABLE` | required checks pass; a non-required check is failing or neutral | mergeable as-is |

`BLOCKED` with every check green is almost always an unresolved review comment:

```bash
gh api graphql -f query='{repository(owner:"OWNER",name:"REPO"){
  pullRequest(number:N){reviewThreads(first:20){nodes{
    id isResolved path line comments(first:1){nodes{body}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[]
        | select(.isResolved==false)'
```

Resolve a thread only after the finding is fixed or answered — reply first,
then resolve, so the reasoning survives in the PR.
