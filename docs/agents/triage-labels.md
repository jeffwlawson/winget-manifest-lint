# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label
string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

> Kept at the defaults deliberately. The obvious-looking override — pointing `ready-for-agent`
> straight at `agent:implement` — would fuse two vocabularies that must stay separate. See
> [The join](#the-join-ready-for-agent--agentimplement) below.

---

## Two vocabularies, one repo

This repo carries **two independent label vocabularies**, and the skills library knows about only
one of them.

| Vocabulary | Written by | Read by | Means |
|---|---|---|---|
| triage (`ready-for-agent`, …) | a human running `/triage`, or `/to-tickets` on publish | humans | *intent* — how well specified is this, and who should do it |
| `agent:*` | a human, or an agent workflow transitioning its own state | GitHub Actions | *workflow state* — which job should run next, and is one running now |

Nothing joins them automatically. This file is the only place they are joined at all, and the join
is a human hand (below).

This is the same distinction `docs/friction.md` recorded on 2026-07-22 under "Label naming was
ambiguous": upstream's `Sandcastle` label is its local spelling of `ready-for-agent` and gates
*human intent*; `agent:implement` gates the *workflow*. They were never the same label wearing two
names.

---

## The `agent:*` vocabulary

Seven labels. Six are live; `agent:queued` is declared but inert (see below). `docs/ADOPTING.md`
§3 has the `gh label create` commands for the six live ones.

| Label | Applied to | Consumed by | Notes |
|---|---|---|---|
| `agent:implement` | issue | `agent-implement.yml` | the only entry point from a plain issue |
| `agent:review` | PR | `agent-review.yml` | added automatically by `agent-implement` on the PR it opens |
| `agent:fix` | PR | `agent-fix.yml` | act on review feedback; always a human decision, never cascaded |
| `agent:update-branch` | PR | `agent-update-branch.yml` | refresh the branch from the PR's base |
| `agent:in-progress` | issue or PR | — | held for the run's duration, removed by an `always()` step |
| `agent:blocked` | issue or PR | — | a run failed or refused; a comment carries the reason |
| `agent:queued` | issue | **nothing yet** | see below |

**Trigger labels are consumed on entry.** That is what makes a retry idempotent — a human re-adds
the label deliberately.

### `agent:queued`

`agent:queued` marks a fully-specified issue that **cannot start yet** because a blocker is still
open — the state `/to-tickets` produces when it publishes a batch with blocking edges, where the
first ticket is workable and the rest are not.

It is documented and created here so the vocabulary is settled before anything writes it, but
**no workflow reads it today**. Promotion (`agent:queued` → `agent:implement` when the last
blocker closes) needs the `agent-promote-queued` workflow, which this repo does not have —
`docs/parity.md` §8 tracks that gap, and its ❌ stands. Until then the label is a note to a human,
with exactly the same weight as writing "blocked by #12" in the body.

Do not add `agent:queued` and expect anything to happen. Adding `agent:implement` to a blocked
issue, on the other hand, *does* happen — immediately, and against unmet dependencies.

---

## The join: `ready-for-agent` → `agent:implement`

**This transition is manual, and stays manual.**

`ready-for-agent` is a claim about the *issue*: it is specified well enough that an agent working
alone will not have to guess. `agent:implement` is a claim about *now*: run a model against this,
push a branch, open a PR, and spend the budget. Those are different assertions, made at different
times, and a triage pass is not entitled to make the second one.

Concretely, a human deciding to promote is deciding:

- the blockers really are closed (nothing checks this — see `agent:queued`);
- the issue's factual claims have been grounded in a primary source, not just written
  confidently. `docs/parity.md` §1 records that **all six** of the pilot's spec errors came from
  small issues written quickly, and argues that no extra advisory workflow is the fix — grounding
  claims at authoring time is what actually closed it;
- this is the next thing worth spending a run on.

Automating the promotion would move all three of those decisions into a label that a triage skill
applies by default — `/to-tickets` applies `ready-for-agent` to every ticket it publishes, "agent-
grabbable by construction". That is the correct default for *triage* and would be a terrible
default for *execution*.

So: `/triage` and `/to-tickets` may write `ready-for-agent` freely. Only a human writes
`agent:implement`.

---

## `wayfinder:*` — planning surface, never the agent loop

`/wayfinder` charts a large effort into a map issue plus child tickets, and labels them:

| Label | On |
|---|---|
| `wayfinder:map` | the map issue — the canonical artifact, holding Notes / Decisions-so-far / Fog |
| `wayfinder:research` | a child ticket that answers a question |
| `wayfinder:prototype` | a child ticket that builds something throwaway to learn from |
| `wayfinder:grilling` | a child ticket that interrogates a plan |
| `wayfinder:task` | a child ticket that is just work |

**No `agent-*` workflow triggers on any of them, and none ever should.** They are a human planning
surface; `docs/parity.md` §1 records the deliberate split — planning happens locally with a human
in the loop, execution happens in CI. A `wayfinder:*` ticket enters the agent loop the same way
any other issue does: a human triages it, then labels it `agent:implement`. The label itself
carries no execution meaning.

`wayfinder:map` in particular must never be labelled `agent:implement`. A map is a container, not
a unit of work, and `agent-implement` has no refusal for that shape (`docs/parity.md` §2 lists
"refuses a sub-issue / PRD-shaped issue" as absent).

---

## Creating the labels

Matching the style of `docs/ADOPTING.md` §3. The five triage labels:

```bash
gh label create "needs-triage"    --color D93F0B --description "Maintainer needs to evaluate this issue"
gh label create "needs-info"      --color FEF2C0 --description "Waiting on reporter for more information"
gh label create "ready-for-agent" --color 006B75 --description "Fully specified, ready for an AFK agent"
gh label create "ready-for-human" --color C5DEF5 --description "Requires human implementation"
gh label create "wontfix"         --color FFFFFF --description "Will not be actioned"
```

GitHub creates `wontfix` in every new repo, so that last line will fail with "label already
exists". That is fine — skip it, or use `gh label edit` if the colour differs.

And the seventh `agent:*` label, alongside the six in `docs/ADOPTING.md` §3:

```bash
gh label create "agent:queued"    --color D4C5F9 --description "Fully specified but blocked; a human promotes it to agent:implement"
```

Only if you drive `/wayfinder` against this repo's tracker:

```bash
gh label create "wayfinder:map"       --color 0052CC --description "A wayfinder map issue"
gh label create "wayfinder:research"  --color BFD4F2 --description "Wayfinder ticket: answer a question"
gh label create "wayfinder:prototype" --color BFD4F2 --description "Wayfinder ticket: build something throwaway to learn from"
gh label create "wayfinder:grilling"  --color BFD4F2 --description "Wayfinder ticket: interrogate a plan"
gh label create "wayfinder:task"      --color BFD4F2 --description "Wayfinder ticket: work"
```

A missing label makes its transition a no-op and the state machine drifts without erroring — the
same failure mode `docs/ADOPTING.md` §3 warns about for the `agent:*` set.
