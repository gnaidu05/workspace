# Case study — CampusRoute

*The proof asset. Send this instead of a portfolio.*

> **Fill in before sending:** `{{YOUR_NAME}}`, `{{YOUR_EMAIL}}`.
> Everything else below is true of the repository as it stands.

---

## The problem

A team needed to plan multi-stop assessment visits: fixed-date visits at
different campuses, travel between them by road, air and rail, overnight stays
to count, and named people to assign to each leg.

It was being done by hand. The question nobody could answer quickly was the one
that mattered — **how much does grouping these visits into shared tours
actually save, against sending one person per visit?**

## What was built

A planner that groups fixed-date visits into tours, works out the travel around
them, counts the overnight stays, assigns teams and named people, and shows the
saving against the one-trip-per-visit baseline.

**No accounts.** A plan starts as a local draft in the browser. Publishing it
returns two links: a **view link** to circulate, and an **edit link** to keep.
Anyone with the view link can read the plan and fork their own copy. No login
screen, no password resets, no user table to administer.

## How it was built

| | |
| --- | --- |
| **Runtime dependencies** | **Zero.** `node:http`, plain ES modules, JSON on disk |
| **Tests** | 45 — engine, rosters, imports, API |
| **Deployments** | Three: Node server, Cloudflare Worker + D1, static single-file build |
| **Front end** | Plain ES modules, no framework |

The same planning engine file runs on the server and in the browser, so both
ends validate identically — a plan the engine rejects is never stored.

## Why this matters to you

Three things this demonstrates, which are the three things that usually go
wrong with a small internal tool:

1. **It has no dependencies, so it does not rot.** Nothing to patch, no
   framework migration in eighteen months, no `npm audit` wall. It will run in
   five years the way it runs today.
2. **It is tested, so changes are safe.** 45 tests mean the next change does not
   quietly break the last one.
3. **It deploys three different ways.** You are not locked to my hosting choice,
   or to me. The source is yours.

## The honest part

CampusRoute is a public rebuild of a private, single-owner planner — the
teardown of the original and every difference is documented in the repository.
It was built to be shown, not sold to a client.

That is exactly why it is worth showing: it is the standard of work, with the
source open to inspection, rather than a screenshot and a claim.

**Live:** https://campusroute-planner.higgsfield.app/planner
**Source:** https://github.com/gnaidu05/workspace/tree/main/campusroute

---

*{{YOUR_NAME}} — {{YOUR_EMAIL}}*
