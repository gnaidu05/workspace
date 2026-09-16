# The kit

Everything between "a stranger has a broken spreadsheet" and "the money has
arrived", in the order it happens.

| Stage | File | What it is |
| --- | --- | --- |
| **1. Find** | `outreach.md` | Where clients are, and how to approach them at zero cost |
| **2. Show** | `offer.html` | The sales page. Self-contained, free to host |
| | `case-study.md` | CampusRoute as proof. Send instead of a portfolio |
| **3. Deliver the audit** | `audit-playbook.md` | The questions, the report, the 3-hour budget |
| **4. Scope the build** | `example-client.json` | One file per client. Copy and edit |
| | `generate.mjs` | `node generate.mjs client.json` → SOW + invoice |
| **5. Get paid** | `documents.mjs` | The money and date arithmetic |
| | `render.mjs` | Print-clean HTML → browser → PDF |

## Going live

**The offer page** needs four placeholders filled — `{{YOUR_NAME}}` once and
`{{YOUR_EMAIL}}` three times, two of which are `mailto:` links. Then copy it to
`docs/` in the repository root and GitHub Pages serves it free.

**A client's paperwork:**

```bash
cp example-client.json clients/northwind.json
$EDITOR clients/northwind.json
node generate.mjs clients/northwind.json out/
```

Open the result in a browser and print to PDF. Both documents are styled for
print, so what you send looks like what you see.

## Things the code refuses to do

These are deliberate. Each one is a mistake that costs real money.

- **A statement of work without an hour cap.** `statementOfWork` throws. A fixed
  price against unbounded effort is the single way this business loses money
  while the selling goes well.
- **A cap below the estimate.** Also throws. That is not a cap, it is a fiction.
- **An invoice whose credits exceed its charges.** Throws, and says to issue a
  credit note instead — which is a different document with different meaning.
- **Sub-cent prices.** Throws rather than silently rounding. Printed lines
  always sum to the printed total; that is the first thing a client checks.
- **Unescaped client data.** Every value is escaped before it reaches the page,
  so a company name containing `&` or `<` cannot break the layout.

## Where the money arithmetic lives

Prices are USD. What you keep is rupees, and the gap between them — payment
rail, exchange rate, Section 44ADA, the new regime — is in `../india.mjs`,
with `../scenarios.mjs` running the real numbers.

Short version: **five Care clients is about Rs 21 lakh a year, taxed at zero.**
