# Venture — a productized automation service

A survival-first plan for turning $10,000 of personal capital into a
service business, with the arithmetic that decides each call kept in code
rather than in a slide.

- `model.mjs` — runway, unit economics and cash projection. Pure functions.
- `scenarios.mjs` — this venture's real numbers. `node scenarios.mjs`.
- `test/model.test.mjs` — 18 tests. `node --test 'test/*.test.mjs'`.

Node 20+. No dependencies.

---

## The finding that sets the strategy

Running the four twelve-month scenarios produces one asymmetry, and every
operating rule below follows from it:

| Scenario | Outcome |
| --- | --- |
| **A.** Nothing sells for a year, spending stays disciplined | **Survives.** Ends at $9,400 |
| **B.** One Build every other month | Survives. Ends at $24,525 |
| **C.** One Build a month | Survives. Ends at $39,651 |
| **D.** $1,500/mo on ads, nothing sells | **Ruin in month 5.** Ends at −$8,600 |

**Failing to sell does not bankrupt this business. Spending does.** A full
year of total commercial failure costs $600. Five months of impatience costs
$18,600 relative to it. The downside is entirely self-inflicted and entirely
controllable, which means the only genuine risk to manage is the urge to
spend money to make something happen.

## The offer

Research on what small businesses actually pay puts the agency entry point at
$5,000–$25,000 for a single scoped workflow, and finds the best fit for 5–25
employee firms in a **$350–$700/month** managed band. Crucially, fixed scope
is what removes sales friction — these buyers have one or two workflows,
a limited budget and no appetite for a scoping call.

Agency pricing is unreachable without a track record. So the ladder starts
below it and climbs on delivered proof:

| | Price | Effort | Effective rate | Purpose |
| --- | --- | --- | --- | --- |
| **Audit** | $250 | 3h | $83/hr | Paid entry. Buys trust, not margin |
| **Build** | $1,500 | 20h | $75/hr | One workflow replaced with a real tool |
| **Care** | $400/mo | 3h/mo | $133/hr | Hosting and changes — **the actual product** |

Care is the only line that compounds. Audit and Build exist to originate Care
clients; a Build that does not convert is a job, not a business.

### The proof already exists

`campusroute/` is a working multi-stop travel planner with 45 tests, zero
runtime dependencies and three live deployments — and it is a rebuild of a
private planner someone needed badly enough to build once already. That is
the exact shape of the offer: *a manual process replaced by a small, tested,
deployed tool.* It is a case study, not a portfolio piece to be written later.

## Operating rules

These are the rules the numbers justify, not preferences.

1. **Infrastructure stays on free tiers until a client pays for it.**
   Verified current burn is **$0/mo**: both live deployments are on free
   plans. That zero is the single most valuable asset here — it is what makes
   Scenario A survivable.
2. **The $3,000 floor is not spendable.** Runway is measured to the floor, not
   to zero, because zero is already too late.
3. **No paid acquisition until at least one Care client is retained.**
   Scenario D is what this rule prevents.
4. **Build is capped at 30 hours.** At 20h it earns $75/hr; at 30h it earns
   $50/hr and stops being worth doing. Fixed price against unbounded scope is
   the one way this loses money while succeeding at selling. Scope is written
   down before work starts, and overrun stops the work rather than absorbing it.
5. **Price rises with proof, not with hope.** Each delivered-and-referenced
   Build is permission to move toward the researched $5k band.

## Break-even

At $50/mo of business burn, **one Care client** covers the whole operation.
That is the entire commercial bar for the business to sustain itself.

The bar that actually matters is different. Personal living costs are not
modelled in `scenarios.mjs` and they dominate every figure above:

| Personal burn | Runway | Care clients to break even |
| --- | --- | --- |
| $0 (covered elsewhere) | indefinite | 1 |
| $1,500/mo | 4.5 months | 5 |
| $2,500/mo | 2.7 months | 7 |
| $4,000/mo | 1.7 months | 11 |

A business needing 1 client and a life needing 7 are different businesses with
different strategies. **This number decides the plan and is the next input
required.**

## Getting paid

No company formation is needed to start. In the US, working for yourself makes
you a sole proprietor by default: invoice under your own legal name using an
SSN, with no LLC, DBA or business licence required to send an invoice or be
paid. Stripe, PayPal and Wise all accept individual accounts.

This matters because it means the path to receiving the first dollar is short
and free — it is not a reason to delay, and not a reason to spend on formation
before there is revenue to protect.

*Jurisdiction-specific and not tax advice; confirm against your own country's
rules before invoicing.*

## Honest base rates

The literature on this is dominated by content marketing with an incentive to
inflate. Filtering for figures that survive that bias: 70% of micro-SaaS
founders earn under $1,000/mo, the median *profitable* one makes $4.2k/mo, and
90% of AI wrapper startups are projected to fail. The median outcome for
"build automated income" is approximately zero.

Services beat that base rate for one reason: revenue starts at the first
client rather than at product-market fit. The tradeoff is that it sells time,
so it does not scale without either raising price or narrowing scope. Both are
on the ladder above; neither is free.

## Sources

- [Micro SaaS launch statistics](https://www.shno.co/marketing-statistics/micro-saas-launch-statistics)
- [AI agent business models 2026](https://agentmarketcap.ai/blog/2026/04/13/1m-ai-agent-startup-revenue-playbook-profitable-business-models-2026)
- [Small business workflow automation pricing](https://ustechautomations.com/resources/blog/small-business-workflow-automation-pricing-guide-2026)
- [AI automation cost and pricing guide](https://hummingagent.ai/blog/ai-automation-cost-pricing-guide-2026)
- [Invoicing without a registered business](https://invoicebloom.io/blog/how-to-create-invoice-without-business)
- [Stripe for sole proprietors](https://wise.com/us/blog/stripe-sole-proprietor)
