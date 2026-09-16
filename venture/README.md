# Venture — a productized automation service, run from India

A survival-first plan for building a service business exporting to overseas
clients, with the arithmetic that decides each call kept in tested code rather
than in a slide.

- `model.mjs` — runway, unit economics, cash projection. Pure functions.
- `india.mjs` — FX, payment rails, Section 44ADA, new-regime tax, thresholds.
- `kit/documents.mjs` — invoices and scope letters as data transforms.
- `scenarios.mjs` — this venture's real numbers. `node scenarios.mjs`.
- `test/` — 48 tests. `node --test 'test/*.test.mjs'`.

Node 20+. No dependencies.

> **Not tax or legal advice.** `india.mjs` applies the published slabs
> arithmetically so the claims below are checkable. A chartered accountant
> signs the return, not this file. The exchange rate (Rs 88) is an assumption,
> not a quote — re-run with today's rate before pricing anything.

---

## 1. The strategy, in one number

| | Per hour |
| --- | --- |
| An hour billed at $60 to an overseas client | **Rs 5,280** |
| The same hour at an Indian market rate | Rs 1,200 |
| | **4.4x** |

$60/hr is unremarkable in the US market — below what an agency there charges.
Billed from India it is excellent. That gap is the entire strategy, and it
argues for one thing above all: **sell abroad, invoice in dollars.** Selling
the same tooling to Indian SMBs earns a quarter as much for identical work.

## 2. The tax ladder

This is the finding that shapes the targets. Under **Section 44ADA** half of
gross professional receipts is deemed income, and under the **new regime** the
87A rebate makes taxable income up to Rs 12 lakh nil. Those compose:

| Receipts | Income tax | Effective |
| --- | --- | --- |
| Rs 10L | **Rs 0** | 0% |
| Rs 20L | **Rs 0** | 0% |
| **Rs 24L** | **Rs 0** | **0%** |
| Rs 30L | Rs 1,09,200 | 3.6% |
| Rs 50L | Rs 3,43,200 | 6.9% |

**Gross receipts up to Rs 24 lakh a year carry no income tax at all.**
Marginal relief means the next rupee over costs one rupee, not sixty thousand —
there is no cliff to fear (`test/india.test.mjs` checks both boundaries).

Three thresholds to plan around:

- **Rs 20L turnover** — GST registration becomes required. Exports of services
  are *zero-rated*: file a **LUT** and invoice foreign clients with no GST.
- **Rs 24L receipts** — income tax starts, gently.
- **Rs 75L receipts** — beyond 44ADA (at >=95% digital receipts; Rs 50L
  otherwise). Books and audit begin.

## 3. The target

Care — the monthly retainer — is the only line that compounds, so it is the
real ladder:

| Care clients | Billed | Kept after tax | Monthly |
| --- | --- | --- | --- |
| 1 | $4,800/yr | Rs 4,18,176 | Rs 34,848 |
| 3 | $14,400/yr | Rs 12,54,528 | Rs 1,04,544 |
| **5** | **$24,000/yr** | **Rs 20,90,880** | **Rs 1,74,240** |
| 10 | $48,000/yr | Rs 39,50,131 | Rs 3,29,178 |

**Five retainer clients clears roughly Rs 21 lakh a year with zero income tax.**
That is the goal. Not fifty clients, not a product launch, not a funding round.
Five.

## 4. The offer

Priced in USD — unremarkable in the client's market, excellent converted:

| | Price | Effort | Earns | Purpose |
| --- | --- | --- | --- | --- |
| **Audit** | $250 | 3h | Rs 7,260/hr | Paid entry. Buys trust, not margin |
| **Build** | $1,500 | 20h | Rs 6,534/hr | One workflow replaced with a real tool |
| **Care** | $400/mo | 3h/mo | Rs 11,616/hr | Hosting and changes — **the product** |

Audit and Build exist to originate Care clients. A Build that does not convert
is a job, not a business.

### The proof already exists

`campusroute/` is a working multi-stop planner with 45 tests, zero runtime
dependencies and three live deployments — and it is a rebuild of a private
planner someone needed badly enough to build once already. That is exactly the
offer: *a manual process replaced by a small, tested, deployed tool.* It is a
case study, not something to write later.

## 5. Getting paid

Every inward remittance needs the right **RBI purpose code** (P0802 for
software and IT services), and a **FIRC/e-FIRA** kept as proof of compliant
receipt. Export proceeds must be realised within **15 months** of the invoice
date — raised from 9 by an RBI amendment effective 14 November 2025.

On rails, the India-first entrants beat the incumbents materially: **Razorpay
MoneySaver Export Account** (free to open, ~1% all-in, automated e-FIRC) and
**Skydo** (flat fees from $5, no forex markup, instant FIRA) versus **Wise**
(e-FIRC for business accounts) and **Payoneer** (manual FIRC requests,
sometimes charged). Stripe is not the default here that it is in the US.

The rail fee compounds: at $24,000/yr, 1% versus 5% is a difference of
Rs 84,480 a year for no work.

## 6. Operating rules

Justified by the numbers, not by preference.

1. **Free tiers until a client pays for infrastructure.** Verified current
   burn: **Rs 0/mo** — both live deployments are on free plans.
2. **No paid acquisition until one Care client is retained.** A year of selling
   nothing costs 3% of capital. A year of buying ads that sell nothing costs
   **57%**. Failing to sell is survivable; impatience is what destroys this.
3. **Build is capped at 30 hours**, agreed in writing before work starts.
   Fixed price against unbounded scope is the one way this loses money while
   the selling succeeds. `kit/documents.mjs` refuses to produce a scope letter
   without a cap.
4. **Invoice in USD on a ~1% rail.** Keep every FIRC.
5. **Price rises with proof, not with hope.**

## 7. Honest base rates

The literature here is dominated by content marketing with an incentive to
inflate. The figures that survive that bias: 70% of micro-SaaS founders earn
under $1,000/mo, the median *profitable* one makes $4.2k/mo, and 90% of AI
wrapper startups are projected to fail. The median outcome for "build automated
income" is approximately zero.

Services beat that base rate for one reason — revenue starts at the first
client rather than at product-market fit. The tradeoff is that it sells time,
so it does not scale without raising price or narrowing scope. The export
arbitrage in section 1 is what makes the time worth enough for that to be fine.

## Sources

- [Income tax slabs FY 2025-26](https://cleartax.in/s/income-tax-slabs)
- [Freelancer income tax in India](https://www.wisemonk.io/blogs/freelancer-income-tax-in-india)
- [Freelancer tax: 44ADA, GST, ITR](https://www.taxaj.com/learn/income-tax-filing-for-freelancers-india/)
- [RBI rules for Indian freelancers with foreign clients](https://www.wisemonk.io/blogs/rbi-rules-for-indian-freelancers)
- [Receiving international payments as a freelancer in India](https://www.winvesta.in/blog/freelancers/how-to-receive-international-payments-as-a-freelancer-in-india-2026-guide)
- [Accepting international payments: Wise, Payoneer, Razorpay](https://www.indietoolkit.in/blog/how-to-accept-international-payments-indian-freelancer)
- [Micro SaaS launch statistics](https://www.shno.co/marketing-statistics/micro-saas-launch-statistics)
- [Small business workflow automation pricing](https://ustechautomations.com/resources/blog/small-business-workflow-automation-pricing-guide-2026)
