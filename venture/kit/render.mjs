// Renders the document objects from documents.mjs into standalone HTML —
// print-clean, so "Save as PDF" in a browser produces the thing you send.
//
// Every value that reaches the page goes through escapeHtml. Client names,
// line descriptions and deliverables are typed by hand into a JSON file, and a
// stray "&" or "<" in a company name should never be able to break the layout
// or inject markup.

import { formatCents } from './documents.mjs';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

/** Party block: name, then any of email / address / lines below it. */
function party(p) {
  const rows = [`<strong>${e(p.name)}</strong>`];
  for (const key of ['email', 'phone', 'address', 'gstin', 'pan']) {
    if (p[key]) rows.push(e(p[key]));
  }
  return rows.join('<br>');
}

function shell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<style>
  :root { --ink:#1a1a1a; --soft:#555; --line:#ddd; --bg:#fff; --accent:#1f5f4f; }
  * { box-sizing:border-box; }
  body {
    margin:0; padding:40px 16px; background:var(--bg); color:var(--ink);
    font:15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .sheet { max-width:720px; margin:0 auto; }
  h1 { font-size:1.5rem; letter-spacing:-.02em; margin:0 0 4px; }
  h2 { font-size:1rem; letter-spacing:.06em; text-transform:uppercase;
       color:var(--accent); margin:32px 0 10px; }
  .muted { color:var(--soft); }
  .head { display:flex; flex-wrap:wrap; gap:24px; justify-content:space-between;
          align-items:flex-start; border-bottom:2px solid var(--ink); padding-bottom:16px; }
  .meta { text-align:right; font-size:.9rem; }
  .parties { display:flex; flex-wrap:wrap; gap:32px; margin:24px 0; font-size:.92rem; }
  .parties > div { min-width:200px; flex:1; }
  .label { font-size:.72rem; text-transform:uppercase; letter-spacing:.09em;
           color:var(--soft); margin-bottom:4px; }
  table { width:100%; border-collapse:collapse; margin:8px 0 0; font-size:.92rem; }
  th { text-align:left; font-size:.72rem; text-transform:uppercase; letter-spacing:.08em;
       color:var(--soft); border-bottom:1px solid var(--line); padding:8px 0; }
  td { padding:10px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  .num { text-align:right; white-space:nowrap; }
  tfoot td { border:0; padding:6px 0; }
  tfoot .total td { border-top:2px solid var(--ink); font-weight:700; font-size:1.05rem;
                    padding-top:12px; }
  ul { margin:6px 0 0; padding-left:20px; }
  li { margin-bottom:6px; }
  .box { border:1px solid var(--line); border-left:3px solid var(--accent);
         padding:14px 16px; margin-top:10px; background:#fafafa; }
  .sign { display:flex; flex-wrap:wrap; gap:40px; margin-top:44px; }
  .sign > div { flex:1; min-width:200px; border-top:1px solid var(--ink);
                padding-top:8px; font-size:.85rem; color:var(--soft); }
  footer { margin-top:40px; padding-top:14px; border-top:1px solid var(--line);
           font-size:.82rem; color:var(--soft); }
  @media print {
    body { padding:0; }
    .box { background:transparent; }
    @page { margin:18mm; }
  }
</style>
</head>
<body><div class="sheet">
${body}
</div></body>
</html>`;
}

export function renderInvoice(inv) {
  const rows = inv.lines
    .map(
      (l) => `      <tr>
        <td>${e(l.description)}</td>
        <td class="num">${l.quantity === 1 ? '' : e(l.quantity)}</td>
        <td class="num">${e(formatCents(l.unitCents))}</td>
        <td class="num">${e(formatCents(l.amountCents))}</td>
      </tr>`,
    )
    .join('\n');

  const taxRow =
    inv.taxCents > 0
      ? `        <tr><td colspan="3" class="num muted">Tax (${(inv.taxRate * 100).toFixed(2)}%)</td>
           <td class="num">${e(formatCents(inv.taxCents))}</td></tr>`
      : '';

  const body = `  <div class="head">
    <div><h1>Invoice</h1><div class="muted">${e(inv.invoiceNumber)}</div></div>
    <div class="meta">
      <div><span class="muted">Issued</span> ${e(inv.issueDate)}</div>
      <div><span class="muted">Due</span> <strong>${e(inv.dueDate)}</strong></div>
    </div>
  </div>

  <div class="parties">
    <div><div class="label">From</div>${party(inv.operator)}</div>
    <div><div class="label">To</div>${party(inv.client)}</div>
  </div>

  <table>
    <thead><tr>
      <th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th>
    </tr></thead>
    <tbody>
${rows}
    </tbody>
    <tfoot>
      <tr><td colspan="3" class="num muted">Subtotal</td>
          <td class="num">${e(formatCents(inv.subtotalCents))}</td></tr>
${taxRow}
      <tr class="total"><td colspan="3" class="num">Total due</td>
          <td class="num">${e(formatCents(inv.totalCents))}</td></tr>
    </tfoot>
  </table>
${inv.notes ? `\n  <div class="box">${e(inv.notes)}</div>` : ''}
  <footer>
    Payable in USD. Services exported from India — zero-rated under GST, supplied
    under LUT. Please quote ${e(inv.invoiceNumber)} with your remittance.
  </footer>`;

  return shell({ title: `Invoice ${inv.invoiceNumber}`, body });
}

export function renderStatementOfWork(sow) {
  const list = (items) => items.map((i) => `      <li>${e(i)}</li>`).join('\n');

  const overage =
    sow.overageRateCents === null
      ? 'Beyond the cap, work stops and we agree a new scope before continuing.'
      : `Beyond the cap, further work is charged at ${formatCents(
          sow.overageRateCents,
        )}/hour, and only with your written go-ahead.`;

  const body = `  <div class="head">
    <div><h1>Statement of work</h1><div class="muted">${e(sow.packageName)}</div></div>
    <div class="meta">
      <div><span class="muted">Starts</span> ${e(sow.startDate)}</div>
      <div><span class="muted">Fixed price</span>
           <strong>${e(formatCents(sow.priceCents))}</strong></div>
    </div>
  </div>

  <div class="parties">
    <div><div class="label">Supplier</div>${party(sow.operator)}</div>
    <div><div class="label">Client</div>${party(sow.client)}</div>
  </div>

  <h2>What gets built</h2>
  <ul>
${list(sow.deliverables)}
  </ul>
${
  sow.exclusions.length
    ? `\n  <h2>What is not included</h2>\n  <ul>\n${list(sow.exclusions)}\n  </ul>`
    : ''
}

  <h2>Price and hours</h2>
  <div class="box">
    <p style="margin:0 0 8px"><strong>${e(formatCents(sow.priceCents))}</strong>, fixed.
    Estimated at <strong>${e(sow.estimatedHours)} hours</strong> and
    <strong>capped at ${e(sow.hourCap)}</strong>.</p>
    <p style="margin:0" class="muted">If it takes longer than estimated but stays under
    the cap, the price does not change — that risk is the supplier's, not yours.
    ${e(overage)}</p>
  </div>

  <h2>Handover</h2>
  <ul>
      <li>Deployed and working, with a short written guide.</li>
      <li>Full source code, yours to keep and to give to anyone else.</li>
      <li>No dependency on the supplier's hosting or continued involvement.</li>
  </ul>

  <div class="sign">
    <div>Signed, for ${e(sow.operator.name)} &mdash; date</div>
    <div>Signed, for ${e(sow.client.name)} &mdash; date</div>
  </div>

  <footer>
    Scope changes are agreed in writing before the work changes. Either party may
    stop the work; completed work is invoiced pro rata against the hours spent.
  </footer>`;

  return shell({ title: `SOW — ${sow.packageName} — ${sow.client.name}`, body });
}
