# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `jeffwlawson/winget-manifest-lint`. Use
the `gh` CLI for all operations.

> **Scope.** This file configures the **local, human-driven** skills (`/triage`, `/to-tickets`,
> `/to-spec`, `/wayfinder`) — the ones a human runs in Claude Code against this repo. The five
> `agent-*` GitHub Actions workflows are *not* covered by it: their runner scripts fetch the issue
> or PR themselves and pass the text in as a prompt argument, and the agent process is expected not
> to shell out to `gh` at all. See `docs/ADOPTING.md` §8 for why that boundary exists.
>
> **`/setup-matt-pocock-skills` overwrites this file.** Everything in it is tracker *mechanics*, so
> re-applying the local additions after a regeneration stays a small diff — the scope note, the
> *Native relations* section, the two *Wayfinding* bullets that cross-reference that section instead
> of repeating the endpoints inline, and the pointer at the bottom. Nothing about PRD shape,
> ordering or labels belongs here for exactly that reason; it lives in
> [`ticket-shape.md`](./ticket-shape.md), which the skill does not touch.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Native relations: sub-issues and blocking

GitHub carries **parent/child** and **blocking** natively, and native is the only form any consumer
can see: the API reports it, the UI draws it, and a workflow can act on it. A `Parent:` or
`Blocked by: #12` line written into a body is none of those things — it reads identically to a human
and is invisible to everything else.

`gh` >= 2.94.0 sets both at creation time (the release that added issue types, sub-issues and
relationships to `gh issue`; verified present in 2.96.0):

- **parent** — `gh issue create --parent <n>`
- **blocked by** — `gh issue create --blocked-by <n>`, comma-separated for several

On an older `gh`, or to attach after the fact, both are REST endpoints:

```bash
id() { gh api "repos/jeffwlawson/winget-manifest-lint/issues/$1" --jq .id; }

# p=parent, c=child, b=blocker, a=anchor — all plain issue numbers, e.g. p=100 c=101 b=101 a=101
# The number goes in the path; the database id goes in the body. Never the other way round.

# attach $c under $p; appends to the end of $p's list
gh api --method POST "repos/jeffwlawson/winget-manifest-lint/issues/$p/sub_issues" \
  -F sub_issue_id="$(id "$c")"

# record that $c is blocked by $b
gh api --method POST "repos/jeffwlawson/winget-manifest-lint/issues/$c/dependencies/blocked_by" \
  -F issue_id="$(id "$b")"

# reorder: move $c to sit directly after $a in $p's list
gh api --method PATCH "repos/jeffwlawson/winget-manifest-lint/issues/$p/sub_issues/priority" \
  -F sub_issue_id="$(id "$c")" -F after_id="$(id "$a")"
```

**Every id in all three is the issue's numeric database id, not its `#number`** — hence the `id()`
helper (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` and not the
`node_id`). That is the trap, and it is silent: an issue number is a valid database id for some
*other* issue, so the call does not fail. It attaches something you did not mean, or nothing.

Read them back with `gh issue view <n> --json subIssues,parent,blockedBy`. GitHub also reports
`issue_dependencies_summary.blocked_by`, counting **open** blockers only — the live gate.

Where sub-issues or dependencies are unavailable, the fallback is a task list in the parent body
plus `Part of #<parent>` / `Blocked by: #<n>` at the top of the child. Human-visible, machine-blind;
use it knowing that.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue — see [Native relations](#native-relations-sub-issues-and-blocking) for the endpoint and the database-id trap. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: a native `blocked_by` edge, same section. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

## Settled elsewhere

The **shape** of a `/to-tickets` batch is not fixed by this file. It is settled in
[`ticket-shape.md`](./ticket-shape.md) (#93), along with the order the tickets are created in, the
labels they carry, and the checks to run before labelling anything. Read it in full before
publishing a batch — it is a procedure, not a preference, and this file deliberately holds no
summary of it.

The wayfinding section above describes `/wayfinder`'s own map-and-children shape, which is a
separate question and already settled by that skill.
