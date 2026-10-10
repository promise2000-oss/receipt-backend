import {
  formatMoney,
  formatDate,
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  round2,
  outstandingBalance,
  type InvoiceStatus,
  type WatermarkConfig,
} from "@eleos/shared";
import { renderWatermark } from "./watermark";

/**
 * The invoice document.
 *
 * Deliberately the *same* template family as the receipt (`document.ts`) —
 * same header band, same itemised table, same totals block, same watermark —
 * because a business issues both and a customer should not be handed two
 * unrelated-looking documents from the same company. What differs is the part
 * that matters: an invoice has a due date, a terms line, a balance rather
 * than an amount paid, and a status that can legitimately be "overdue".
 *
 * It is rendered server-side and fed to Puppeteer exactly like the receipt,
 * so the watermark is part of the exported PDF rather than a browser overlay.
 */

export interface InvoiceDocumentItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface InvoiceDocumentPayment {
  amount: number;
  paid_at: string | Date;
  method: string;
  reference?: string | null;
}

export interface InvoiceDocumentData {
  business: {
    name: string;
    logo_data_url?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    currency: string;
    brand_primary: string;
    brand_accent: string;
  };
  invoice: {
    invoice_number: string;
    issue_date: string | Date;
    due_date?: string | Date | null;
    items: InvoiceDocumentItem[];
    subtotal: number;
    discount: number;
    tax: number;
    tax_rate: number;
    total: number;
    amount_paid: number;
    status: InvoiceStatus;
    notes?: string | null;
    terms?: string | null;
    po_reference?: string | null;
    customer?: { name: string; phone?: string | null; email?: string | null } | null;
    payments?: InvoiceDocumentPayment[];
  };
  logo_data_url?: string | null;
  watermark?: Partial<WatermarkConfig> | null;
}

function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function qty(value: number): string {
  const n = round2(Number(value));
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Status is carried by a word as well as a colour, never by colour alone —
 * the same rule the app UI follows for WCAG reasons.
 */
function statusClass(status: InvoiceStatus): string {
  switch (status) {
    case "paid":
      return "pill-paid";
    case "partially_paid":
      return "pill-partial";
    case "overdue":
      return "pill-overdue";
    case "cancelled":
      return "pill-void";
    default:
      return "pill-pending";
  }
}

function sumRow(label: string, value: string, cls = ""): string {
  return `<div class="sum-row ${cls}"><span>${esc(label)}</span><span>${value}</span></div>`;
}

export function renderInvoiceHtml(input: InvoiceDocumentData): string {
  const { business, invoice } = input;
  const primary = business.brand_primary || "#111111";
  const accent = business.brand_accent || "#B8912F";
  const currency = business.currency || "NGN";
  const logo = input.logo_data_url ?? business.logo_data_url ?? null;

  const balance = outstandingBalance(invoice.total, invoice.amount_paid);
  const cancelled = invoice.status === "cancelled";
  const watermark = renderWatermark(input.watermark);

  const contactLines = [business.address, business.phone, business.email, business.website].filter(
    (line): line is string => Boolean(line),
  );

  const itemsHtml = invoice.items
    .map(
      (item, index) => `
        <tr>
          <td class="c-num">${index + 1}</td>
          <td class="c-desc">${esc(item.description)}</td>
          <td class="c-qty">${qty(item.quantity)}</td>
          <td class="c-money">${formatMoney(item.unit_price, currency)}</td>
          <td class="c-money strong">${formatMoney(item.line_total, currency)}</td>
        </tr>`,
    )
    .join("");

  const customer = invoice.customer;

  const paymentsHtml = (invoice.payments ?? [])
    .map(
      (payment) => `
        <tr>
          <td>${esc(formatDate(payment.paid_at))}</td>
          <td>${esc(
            PAYMENT_METHOD_LABELS[payment.method as keyof typeof PAYMENT_METHOD_LABELS] ??
              payment.method,
          )}</td>
          <td>${esc(payment.reference ?? "—")}</td>
          <td class="c-money strong">${formatMoney(payment.amount, currency)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${esc(invoice.invoice_number)} — ${esc(business.name)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@300;400;500;600;700;800&display=swap');

  :root {
    --primary: ${primary};
    --accent: ${accent};
    --cream: #FBF7EE;
    --ink: #111111;
    --muted: #6B6459;
    --rule: #E7DFCE;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    background: var(--cream);
    font-family: Inter, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }

  .sheet {
    padding: 28px;
    min-height: 100%;
    display: flex;
    justify-content: center;
  }

  .frame {
    width: 100%;
    max-width: 760px;
    background: var(--cream);
    border: 1.5px solid var(--accent);
    border-radius: 12px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* ---- Header band ---------------------------------------------------- */
  .band {
    background: var(--primary);
    color: var(--cream);
    padding: 26px 34px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .brand { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .logo {
    width: 54px; height: 54px;
    border-radius: 10px;
    object-fit: contain;
    background: var(--cream);
    padding: 5px;
    flex: none;
  }
  .logo-fallback {
    width: 54px; height: 54px;
    border-radius: 10px;
    border: 1px solid var(--accent);
    display: flex; align-items: center; justify-content: center;
    font-family: "Playfair Display", Georgia, serif;
    font-size: 24px; color: var(--accent);
    flex: none;
  }
  .wordmark {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 25px;
    font-weight: 600;
    letter-spacing: 0.4px;
    line-height: 1.1;
    margin: 0;
    word-break: break-word;
  }
  .subline {
    margin-top: 5px;
    font-size: 10.5px;
    letter-spacing: 2.4px;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 500;
  }
  .band-right { text-align: right; flex: none; }
  .band-right .label {
    font-size: 10px; letter-spacing: 3px; text-transform: uppercase;
    color: rgba(251, 247, 238, 0.62); font-weight: 500;
  }
  .band-right .number {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 22px; font-weight: 600; color: var(--accent);
    margin-top: 4px; letter-spacing: 1px;
  }

  /* ---- Body ----------------------------------------------------------- */
  .body { padding: 30px 34px 26px; flex: 1; display: flex; flex-direction: column; }
  .spacer { flex: 1 1 auto; min-height: 0; }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 40px;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--rule);
  }
  .meta h4 {
    margin: 0 0 9px;
    font-size: 9.5px; letter-spacing: 2.6px; text-transform: uppercase;
    color: var(--accent); font-weight: 600;
  }
  .meta .name { font-size: 15px; font-weight: 600; margin-bottom: 3px; }
  .meta .line { font-size: 12.5px; color: var(--muted); line-height: 1.65; }
  .meta .right { text-align: right; }

  .pill {
    display: inline-block;
    padding: 4px 13px;
    border-radius: 999px;
    font-size: 10px; font-weight: 700;
    letter-spacing: 1.4px; text-transform: uppercase;
    margin-top: 8px;
  }
  .pill-paid { background: var(--accent); color: var(--cream); }
  .pill-partial { background: transparent; color: var(--accent); border: 1.2px solid var(--accent); }
  .pill-pending { background: transparent; color: var(--muted); border: 1.2px solid #B9B2A4; }
  .pill-overdue { background: #B3261E; color: #FFFFFF; }
  .pill-void { background: #EFE7D6; color: #8A8172; border: 1.2px solid #8A8172; }

  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  thead th {
    font-size: 9.5px; letter-spacing: 2.2px; text-transform: uppercase;
    font-weight: 600; color: var(--muted);
    padding: 0 0 10px; border-bottom: 1.5px solid var(--accent);
    text-align: left;
  }
  thead th.c-num, thead th.c-qty { text-align: center; }
  thead th.c-money, thead th:last-child { text-align: right; }

  tbody td {
    font-size: 13px; padding: 13px 0;
    border-bottom: 1px solid var(--rule);
    vertical-align: top; line-height: 1.45;
  }
  tbody tr:last-child td { border-bottom: none; }
  .c-num { width: 34px; text-align: center; color: var(--muted); }
  .c-qty { width: 58px; text-align: center; color: var(--muted); }
  .c-money { text-align: right; white-space: nowrap; width: 118px; }
  .c-desc { padding-right: 16px; }
  .strong { font-weight: 600; }

  /* ---- Totals ---------------------------------------------------------- */
  .totals-wrap { display: flex; justify-content: flex-end; margin-top: 20px; }
  .totals { width: 300px; }
  .sum-row {
    display: flex; justify-content: space-between; gap: 20px;
    padding: 7px 0; font-size: 13px; color: var(--muted);
  }
  .sum-row span:last-child { color: var(--ink); font-variant-numeric: tabular-nums; }

  .total-row {
    margin-top: 8px; background: var(--accent); color: var(--cream);
    border-radius: 8px; padding: 14px 16px;
    display: flex; justify-content: space-between; align-items: baseline; gap: 20px;
  }
  .total-row .label {
    font-size: 10.5px; letter-spacing: 2.4px; text-transform: uppercase; font-weight: 600;
  }
  .total-row .value {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums;
  }

  .balance-row {
    margin-top: 10px; padding: 12px 16px;
    background: rgba(255, 255, 255, 0.6);
    border: 1.2px solid var(--rule);
    border-radius: 8px;
    display: flex; justify-content: space-between; align-items: baseline; gap: 20px;
  }
  .balance-row .label {
    font-size: 10.5px; letter-spacing: 2.4px; text-transform: uppercase;
    color: var(--muted); font-weight: 600;
  }
  .balance-row .value {
    font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink);
  }

  .payments-head {
    margin-top: 26px;
    font-size: 9.5px; letter-spacing: 2.6px; text-transform: uppercase;
    color: var(--accent); font-weight: 600;
  }
  table.payments { margin-top: 8px; }
  table.payments thead th { border-bottom: 1px solid var(--rule); }

  .terms {
    margin-top: 20px; padding: 13px 16px;
    background: rgba(255, 255, 255, 0.55);
    border-left: 2px solid var(--accent);
    border-radius: 0 8px 8px 0;
    font-size: 12px; color: var(--muted); line-height: 1.6;
  }

  /* ---- Footer ---------------------------------------------------------- */
  .footer {
    margin-top: 26px; padding-top: 18px;
    border-top: 1px solid var(--rule);
    display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
  }
  .footer .thanks {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 15px; color: var(--ink); margin-bottom: 7px;
  }
  .disclaimer { font-size: 10px; color: var(--muted); line-height: 1.65; max-width: 430px; }
  .contact { font-size: 10.5px; color: var(--muted); text-align: right; line-height: 1.7; }
  .footer-rule { height: 1px; background: var(--accent); opacity: 0.5; margin-bottom: 16px; }

  .powered {
    margin-top: 13px; font-size: 9px; letter-spacing: 1.6px;
    text-transform: uppercase; color: var(--muted);
  }
  .powered b { color: var(--ink); font-weight: 700; letter-spacing: 2px; }

  .void-banner {
    background: var(--accent); color: var(--cream);
    text-align: center; padding: 9px;
    font-size: 10.5px; letter-spacing: 2.4px; text-transform: uppercase; font-weight: 700;
  }

  /* The content that must stay above the watermark. */
  .band, .body, .void-banner { position: relative; z-index: 1; }
${watermark.css}

  @media print {
    @page { size: A4; margin: 0; }
    html, body { background: var(--cream); }
    .sheet { padding: 0; min-height: 297mm; }
    .frame {
      border-radius: 0; max-width: none;
      border-left: none; border-right: none;
    }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="frame">
      ${watermark.html}
      ${
        cancelled
          ? `<div class="void-banner">Cancelled${invoice.terms ? ` — ${esc(invoice.terms)}` : ""}</div>`
          : ""
      }

      <header class="band">
        <div class="brand">
          ${
            logo
              ? `<img class="logo" src="${esc(logo)}" alt="${esc(business.name)} logo" />`
              : `<div class="logo-fallback">${esc((business.name || "I").trim().charAt(0).toUpperCase())}</div>`
          }
          <div>
            <h1 class="wordmark">${esc(business.name)}</h1>
            <div class="subline">Invoice</div>
          </div>
        </div>
        <div class="band-right">
          <div class="label">Invoice No.</div>
          <div class="number">${esc(invoice.invoice_number)}</div>
        </div>
      </header>

      <div class="body">
        <div class="meta">
          <div>
            <h4>Billed To</h4>
            ${
              customer
                ? `<div class="name">${esc(customer.name)}</div>
                   <div class="line">${esc(customer.phone ?? "")}</div>
                   <div class="line">${esc(customer.email ?? "")}</div>`
                : `<div class="name">Walk-in Customer</div>
                   <div class="line">No customer attached to this invoice</div>`
            }
          </div>
          <div class="right">
            <h4>Invoice Details</h4>
            <div class="line"><strong style="color:var(--ink)">Issued:</strong> ${esc(formatDate(invoice.issue_date))}</div>
            ${
              invoice.due_date
                ? `<div class="line"><strong style="color:var(--ink)">Due:</strong> ${esc(formatDate(invoice.due_date))}</div>`
                : ""
            }
            ${
              invoice.po_reference
                ? `<div class="line"><strong style="color:var(--ink)">PO:</strong> ${esc(invoice.po_reference)}</div>`
                : ""
            }
            <span class="pill ${statusClass(invoice.status)}">${esc(
              INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status,
            )}</span>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th class="c-num">#</th>
              <th>Description</th>
              <th class="c-qty">Qty</th>
              <th class="c-money">Unit Price</th>
              <th class="c-money">Amount</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        <div class="totals-wrap">
          <div class="totals">
            ${sumRow("Subtotal", formatMoney(invoice.subtotal, currency))}
            ${
              invoice.discount > 0
                ? sumRow(`Discount`, `−${formatMoney(invoice.discount, currency)}`)
                : ""
            }
            ${
              invoice.tax > 0
                ? sumRow(
                    `Tax${invoice.tax_rate > 0 ? ` (${qty(invoice.tax_rate)}%)` : ""}`,
                    formatMoney(invoice.tax, currency),
                  )
                : ""
            }
            <div class="total-row">
              <span class="label">Total</span>
              <span class="value">${formatMoney(invoice.total, currency)}</span>
            </div>
          </div>
        </div>

        <div class="totals-wrap">
          <div class="totals">
            <div class="balance-row">
              <span class="label">Amount Paid</span>
              <span class="value">${formatMoney(invoice.amount_paid, currency)}</span>
            </div>
            <div class="balance-row" style="margin-top:8px;">
              <span class="label">Balance Due</span>
              <span class="value">${formatMoney(balance, currency)}</span>
            </div>
          </div>
        </div>

        ${
          paymentsHtml
            ? `<div class="payments-head">Payments Received</div>
               <table class="payments">
                 <thead>
                   <tr>
                     <th>Date</th><th>Method</th><th>Reference</th><th class="c-money">Amount</th>
                   </tr>
                 </thead>
                 <tbody>${paymentsHtml}</tbody>
               </table>`
            : ""
        }

        ${invoice.terms ? `<div class="terms"><strong>Terms:</strong> ${esc(invoice.terms)}</div>` : ""}
        ${invoice.notes ? `<div class="terms">${esc(invoice.notes)}</div>` : ""}

        <div class="spacer" aria-hidden="true"></div>

        <div class="footer">
          <div>
            <div class="footer-rule"></div>
            <div class="thanks">Thank you for your business.</div>
            <div class="disclaimer">
              This invoice was issued electronically by ${esc(business.name)} and records
              the amount owed and the payments received against it. Please quote the
              invoice number when making payment.
            </div>
            <div class="powered">Powered by <b>VisionaryGene</b></div>
          </div>
          <div>
            <div class="contact">${contactLines.map(esc).join("<br/>")}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}