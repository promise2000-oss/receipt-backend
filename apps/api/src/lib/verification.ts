import { formatMoney, formatDate } from "@eleos/shared";

/**
 * The public receipt verification page — what you get when the QR code on a
 * printed receipt is scanned.
 *
 * Deliberately minimal: it answers "is this receipt real, who issued it, for
 * how much" and nothing else. No line items, no customer contact details, no
 * tenancy ids — the token proves possession of the paper, not a right to the
 * whole record.
 *
 * Self-contained (inline CSS, system fonts) so it renders instantly on a phone
 * with no network beyond this one request, and every colour combination below
 * is checked against WCAG AA so a brand colour can never make it unreadable.
 */

export interface VerificationInput {
  business: {
    name: string;
    logo_data_url?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    brand_primary: string;
  };
  receipt: {
    receipt_number: string;
    issue_date: string | Date;
    total: number;
    currency: string;
    status: "active" | "void";
    payment_status: string;
    voided_at?: string | Date | null;
    void_reason?: string | null;
  };
}

/** Escape anything interpolated into the page. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 0;
  const int = Number.parseInt(match[1], 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Never let an organization's brand colour decide whether this page can be
 * read: if it cannot clear AA as an accent on white it is swapped for a
 * neutral ink.
 */
function safeAccent(brandPrimary: string): string {
  return contrast(brandPrimary, "#ffffff") >= 3 ? brandPrimary : "#111111";
}

export function renderVerificationHtml(input: VerificationInput): string {
  const { business, receipt } = input;
  const accent = safeAccent(business.brand_primary);
  const isVoid = receipt.status === "void";
  const currency = receipt.currency || "NGN";

  const initials = (business.name || "?").trim().charAt(0).toUpperCase();

  const statusLabel = isVoid ? "Voided" : "Valid Receipt";
  const statusDetail = isVoid
    ? [
        receipt.voided_at ? `Voided ${formatDate(receipt.voided_at)}` : "This receipt has been voided.",
        receipt.void_reason ? `Reason: ${receipt.void_reason}` : "",
      ]
        .filter(Boolean)
        .join(" — ")
    : "This receipt was issued by the organization named above and has not been voided.";

  const rows: Array<[string, string]> = [
    ["Organization", business.name],
    ["Receipt", `#${receipt.receipt_number}`],
    ["Amount", formatMoney(receipt.total, currency)],
    ["Date", formatDate(receipt.issue_date)],
    ["Status", isVoid ? "Voided" : "Verified"],
  ];

  const contactLines = [business.address, business.phone, business.email, business.website].filter(
    (line): line is string => Boolean(line),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Verify receipt ${esc(receipt.receipt_number)} — ${esc(business.name)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #f4f2ec;
    color: #111111;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex;
    justify-content: center;
    padding: 24px 16px 40px;
  }
  .card {
    width: 100%;
    max-width: 460px;
    background: #ffffff;
    border: 1px solid #e3ded2;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 8px 28px rgba(17, 17, 17, 0.07);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 22px 24px;
    border-bottom: 1px solid #eae5da;
  }
  .mark {
    width: 52px; height: 52px;
    border-radius: 11px;
    background: #ffffff;
    border: 1px solid #e3ded2;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    flex: none;
  }
  .mark img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
  .mark span {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 26px;
    color: ${accent};
    font-weight: 600;
  }
  .head h1 { font-size: 19px; margin: 0; line-height: 1.25; word-break: break-word; }
  .head p { margin: 4px 0 0; font-size: 12px; color: #565047; letter-spacing: 0.4px; }

  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 24px;
    background: ${isVoid ? "#fbeeee" : "#eef7f0"};
    border-bottom: 1px solid #eae5da;
  }
  .glyph {
    width: 34px; height: 34px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 19px; font-weight: 700;
    flex: none;
    background: ${isVoid ? "#a32020" : "#15692f"};
    color: #ffffff;
  }
  .banner strong { display: block; font-size: 16px; color: ${isVoid ? "#7d1a1a" : "#0f4f24"}; }
  .banner .detail { font-size: 12.5px; color: #4a453d; margin-top: 3px; line-height: 1.5; }

  dl { margin: 0; padding: 8px 24px 4px; }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 13px 0;
    border-bottom: 1px solid #f0ece2;
    font-size: 14.5px;
  }
  .row:last-child { border-bottom: none; }
  dt { color: #565047; font-size: 12.5px; letter-spacing: 0.6px; text-transform: uppercase; }
  dd { margin: 0; font-weight: 600; text-align: right; word-break: break-word; }
  dd.big { font-size: 21px; font-variant-numeric: tabular-nums; }
  dd.pill {
    background: ${isVoid ? "#a32020" : "#15692f"};
    color: #ffffff;
    padding: 4px 13px;
    border-radius: 999px;
    font-size: 12px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .foot {
    padding: 16px 24px 22px;
    border-top: 1px solid #eae5da;
    font-size: 12.5px;
    color: #565047;
    line-height: 1.7;
  }
  .foot .contact { margin-bottom: 10px; word-break: break-word; }
  .powered { font-size: 10.5px; letter-spacing: 1.4px; text-transform: uppercase; color: #7a746a; }
  .powered b { color: #111111; letter-spacing: 1.8px; }

  @media print {
    body { background: #ffffff; padding: 0; }
    .card { box-shadow: none; border: 0; max-width: none; }
  }
</style>
</head>
<body>
  <main class="card">
    <div class="head">
      <div class="mark">
        ${
          business.logo_data_url
            ? `<img src="${esc(business.logo_data_url)}" alt="${esc(business.name)} logo" />`
            : `<span aria-hidden="true">${esc(initials)}</span>`
        }
      </div>
      <div>
        <h1>${esc(business.name)}</h1>
        <p>Receipt verification</p>
      </div>
    </div>

    <div class="banner" role="status">
      <div class="glyph" aria-hidden="true">${isVoid ? "!" : "✓"}</div>
      <div>
        <strong>${esc(statusLabel)}</strong>
        <div class="detail">${esc(statusDetail)}</div>
      </div>
    </div>

    <dl>
      ${rows
        .map(([label, value]) => {
          const className =
            label === "Amount" ? "big" : label === "Status" ? "pill" : "";
          return `<div class="row"><dt>${esc(label)}</dt><dd class="${className}">${esc(value)}</dd></div>`;
        })
        .join("\n      ")}
    </dl>

    <div class="foot">
      ${
        contactLines.length
          ? `<div class="contact">${contactLines.map(esc).join("<br/>")}</div>`
          : ""
      }
      <div class="powered">Powered by <b>VisionaryGene</b></div>
    </div>
  </main>
</body>
</html>`;
}
