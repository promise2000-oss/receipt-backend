import {
  formatMoney,
  formatDate,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  round2,
} from "@eleos/shared";

/**
 * The receipt document.
 *
 * This one template renders both the in-app preview (`GET /receipts/:id/document`,
 * shown in an iframe) and the PDF (the same HTML fed to Puppeteer), so what the
 * user approves on screen is exactly what lands in the file.
 *
 * Layout, top to bottom:
 *   gold frame → black header band with logo → meta columns → itemised table
 *   → gold-highlighted total row → payment strip → footer disclaimer
 */

export interface DocumentItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface DocumentData {
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
  receipt: {
    receipt_number: string;
    issue_date: string | Date;
    items: DocumentItem[];
    subtotal: number;
    discount: number;
    tax: number;
    tax_rate: number;
    total: number;
    paid_amount: number;
    payment_method: string;
    payment_status: string;
    status: "active" | "void";
    voided_at?: string | Date | null;
    void_reason?: string | null;
    notes?: string | null;
    customer?: { name: string; phone?: string | null; email?: string | null } | null;
  };
  /** Absolute or data: URLs only — the PDF renderer has no page origin. */
  logo_data_url?: string | null;
  /** Public verification page this receipt's QR code resolves to. */
  verify_url?: string | null;
  /** Pre-encoded QR as a data: URL (see lib/qr.ts). */
  qr_data_url?: string | null;
}

/** Escape anything interpolated into the document. */
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

function statusPill(data: DocumentData): string {
  const { status, payment_status: paymentStatus } = data.receipt;

  if (status === "void") {
    return `<span class="pill pill-void">VOID</span>`;
  }
  if (paymentStatus === "paid") {
    return `<span class="pill pill-paid">PAID</span>`;
  }
  if (paymentStatus === "partial") {
    return `<span class="pill pill-partial">PARTIALLY PAID</span>`;
  }
  return `<span class="pill pill-pending">PENDING</span>`;
}

function paymentMethodLabel(method: string): string {
  return (
    PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ??
    (method ? method[0].toUpperCase() + method.slice(1) : "—")
  );
}

function paymentStatusLabel(status: string): string {
  return (
    PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] ??
    (status ? status[0].toUpperCase() + status.slice(1) : "—")
  );
}

function row(label: string, value: string, cls = ""): string {
  return `<div class="sum-row ${cls}"><span>${esc(label)}</span><span>${value}</span></div>`;
}

export function renderReceiptHtml(input: DocumentData): string {
  const { business, receipt } = input;
  const primary = business.brand_primary || "#111111";
  const accent = business.brand_accent || "#B8912F";
  const currency = business.currency || "NGN";
  const logo = input.logo_data_url ?? business.logo_data_url ?? null;
  const qr = input.qr_data_url ?? null;
  const isVoid = receipt.status === "void";

  // Issuer contact lines, in order, blanks dropped so we never print a
  // dangling separator when an organization leaves a field empty.
  const contactLines = [business.address, business.phone, business.email, business.website].filter(
    (line): line is string => Boolean(line),
  );

  const balance = round2(receipt.total - receipt.paid_amount);

  const itemsHtml = receipt.items
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

  const customer = receipt.customer;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Receipt ${esc(receipt.receipt_number)} — ${esc(business.name)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');

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
    font-family: Inter, Manrope, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }

  .sheet {
    padding: 28px;
    min-height: 100%;
    display: flex;
    justify-content: center;
  }

  /* Gold frame around the whole receipt. It stretches with the page so the
     border wraps the full sheet instead of stopping under the last line. */
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
  .body {
    padding: 30px 34px 26px;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  /* Absorbs the leftover space so the footer sits on the last line of the
     sheet; collapses to nothing when the receipt runs long. */
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
    font-size: 9.5px;
    letter-spacing: 2.6px;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 600;
  }
  .meta .name { font-size: 15px; font-weight: 600; margin-bottom: 3px; }
  .meta .line { font-size: 12.5px; color: var(--muted); line-height: 1.65; }
  .meta .right { text-align: right; }

  .pill {
    display: inline-block;
    padding: 4px 13px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    margin-top: 8px;
  }
  .pill-paid { background: var(--accent); color: var(--cream); }
  .pill-partial { background: transparent; color: var(--accent); border: 1.2px solid var(--accent); }
  .pill-pending { background: transparent; color: var(--muted); border: 1.2px solid #B9B2A4; }
  .pill-void { background: #EFE7D6; color: #8A8172; border: 1.2px solid #8A8172; }

  /* ---- Itemised table -------------------------------------------------- */
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  thead th {
    font-size: 9.5px;
    letter-spacing: 2.2px;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--muted);
    padding: 0 0 10px;
    border-bottom: 1.5px solid var(--accent);
    text-align: left;
  }
  thead th.c-num, thead th.c-qty { text-align: center; }
  thead th.c-money, thead th:last-child { text-align: right; }

  tbody td {
    font-size: 13px;
    padding: 13px 0;
    border-bottom: 1px solid var(--rule);
    vertical-align: top;
    line-height: 1.45;
  }
  tbody tr:last-child td { border-bottom: none; }
  .c-num { width: 34px; text-align: center; color: var(--muted); }
  .c-qty { width: 58px; text-align: center; color: var(--muted); }
  .c-money { text-align: right; white-space: nowrap; width: 118px; }
  .c-desc { padding-right: 16px; }
  .strong { font-weight: 600; }

  /* ---- Totals ---------------------------------------------------------- */
  .totals-wrap {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
  }
  .totals { width: 300px; }
  .sum-row {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    padding: 7px 0;
    font-size: 13px;
    color: var(--muted);
  }
  .sum-row span:last-child { color: var(--ink); font-variant-numeric: tabular-nums; }
  .sum-row .rule-top { border-top: 1px solid var(--rule); }

  .total-row {
    margin-top: 8px;
    background: var(--accent);
    color: var(--cream);
    border-radius: 8px;
    padding: 14px 16px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 20px;
  }
  .total-row .label {
    font-size: 10.5px;
    letter-spacing: 2.4px;
    text-transform: uppercase;
    font-weight: 600;
  }
  .total-row .value {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 26px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .paid-strip {
    margin-top: 16px;
    display: flex;
    gap: 26px;
    flex-wrap: wrap;
    font-size: 11.5px;
    color: var(--muted);
  }
  .paid-strip b { color: var(--ink); font-weight: 600; }

  .notes {
    margin-top: 20px;
    padding: 13px 16px;
    background: rgba(255, 255, 255, 0.55);
    border-left: 2px solid var(--accent);
    border-radius: 0 8px 8px 0;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  /* ---- Footer ---------------------------------------------------------- */
  .footer {
    margin-top: 26px;
    padding-top: 18px;
    border-top: 1px solid var(--rule);
    display: flex;
    justify-content: space-between;
    gap: 24px;
    align-items: flex-end;
  }
  .footer .thanks {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 15px;
    color: var(--ink);
    margin-bottom: 7px;
  }
  .disclaimer { font-size: 10px; color: var(--muted); line-height: 1.65; max-width: 430px; }
  .contact { font-size: 10.5px; color: var(--muted); text-align: right; line-height: 1.7; }
  .footer-rule { height: 1px; background: var(--accent); opacity: 0.5; margin-bottom: 16px; }

  /* Right-hand footer column: verification QR above the issuer's contact
     details. The white plate baked into the QR data URL guarantees the quiet
     zone whatever the surrounding tint. */
  .footer-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 14px;
    flex: none;
  }
  .qr-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding: 7px;
    background: #ffffff;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }
  .qr-block img { width: 84px; height: 84px; display: block; }
  .qr-caption {
    font-size: 8px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
    text-align: center;
    line-height: 1.4;
  }

  /* Platform attribution — deliberately quiet so the issuer stays primary. */
  .powered {
    margin-top: 13px;
    font-size: 9px;
    letter-spacing: 1.6px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .powered b { font-weight: 700; color: var(--ink); letter-spacing: 2px; }

  .void-banner {
    background: var(--accent);
    color: var(--cream);
    text-align: center;
    padding: 9px;
    font-size: 10.5px;
    letter-spacing: 2.4px;
    text-transform: uppercase;
    font-weight: 700;
  }
  .void-watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-18deg);
    font-family: "Playfair Display", Georgia, serif;
    font-size: 128px;
    font-weight: 700;
    letter-spacing: 14px;
    color: rgba(184, 145, 47, 0.16);
    pointer-events: none;
    z-index: 2;
    white-space: nowrap;
  }

  @media print {
    @page { size: A4; margin: 0; }
    html, body { background: var(--cream); }
    /* Percentages resolve against content in paged media, so the sheet uses
       the physical A4 height to keep the gold frame around the whole page. */
    .sheet { padding: 0; min-height: 297mm; }
    .frame {
      border-radius: 0;
      max-width: none;
      border-left: none;
      border-right: none;
    }
    .void-watermark { color: rgba(184, 145, 47, 0.2); }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="frame">
      ${isVoid ? '<div class="void-watermark" aria-hidden="true">VOID</div>' : ""}
      ${
        isVoid
          ? `<div class="void-banner">Voided${receipt.voided_at ? ` — ${esc(formatDate(receipt.voided_at))}` : ""}${
              receipt.void_reason ? ` — ${esc(receipt.void_reason)}` : ""
            }</div>`
          : ""
      }

      <header class="band">
        <div class="brand">
          ${
            logo
              ? `<img class="logo" src="${esc(logo)}" alt="${esc(business.name)} logo" />`
              : `<div class="logo-fallback">${esc((business.name || "E").trim().charAt(0).toUpperCase())}</div>`
          }
          <div>
            <h1 class="wordmark">${esc(business.name)}</h1>
            <div class="subline">Sales Receipt</div>
          </div>
        </div>
        <div class="band-right">
          <div class="label">Receipt No.</div>
          <div class="number">${esc(receipt.receipt_number)}</div>
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
                   <div class="line">No customer attached to this receipt</div>`
            }
          </div>
          <div class="right">
            <h4>Receipt Details</h4>
            <div class="line"><strong style="color:var(--ink)">Issued:</strong> ${esc(formatDate(receipt.issue_date))}</div>
            <div class="line"><strong style="color:var(--ink)">Payment:</strong> ${esc(paymentMethodLabel(receipt.payment_method))} · ${esc(paymentStatusLabel(receipt.payment_status))}</div>
            ${statusPill({ business, receipt, logo_data_url: logo })}
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
            ${row("Subtotal", formatMoney(receipt.subtotal, currency))}
            ${
              receipt.discount > 0
                ? row(`Discount`, `−${formatMoney(receipt.discount, currency)}`)
                : ""
            }
            ${
              receipt.tax > 0
                ? row(
                    `Tax${receipt.tax_rate > 0 ? ` (${qty(receipt.tax_rate)}%)` : ""}`,
                    formatMoney(receipt.tax, currency),
                  )
                : ""
            }
            <div class="total-row">
              <span class="label">Total</span>
              <span class="value">${formatMoney(receipt.total, currency)}</span>
            </div>
          </div>
        </div>

        <div class="paid-strip">
          <span>Amount paid: <b>${formatMoney(receipt.paid_amount, currency)}</b></span>
          <span>Balance: <b>${formatMoney(balance, currency)}</b></span>
          <span>Method: <b>${esc(paymentMethodLabel(receipt.payment_method))}</b></span>
        </div>

        ${receipt.notes ? `<div class="notes">${esc(receipt.notes)}</div>` : ""}

        <div class="spacer" aria-hidden="true"></div>

        <div class="footer">
          <div>
            <div class="footer-rule"></div>
            <div class="thanks">Thank you for your business.</div>
            <div class="disclaimer">
              This receipt is a record of payment issued by ${esc(business.name)} and is
              valid without signature. Goods once sold are subject to the issuer's
              published returns policy. Please retain this receipt for your records.
              Issued electronically.
            </div>
            <div class="powered">Powered by <b>VisionaryGene</b></div>
          </div>
          <div class="footer-side">
            ${
              qr
                ? `<div class="qr-block">
              <img src="${esc(qr)}" alt="Scan to verify receipt ${esc(receipt.receipt_number)}" width="84" height="84" />
              <div class="qr-caption">Scan to verify</div>
            </div>`
                : ""
            }
            <div class="contact">${contactLines.map(esc).join("<br/>")}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
