import type { ReceiptDTO } from "@eleos/shared";

/**
 * Badge rules from the design spec:
 *   Paid    → solid gold pill
 *   Pending → grey outline
 *   Void    → struck through
 *   Partial → gold outline (sits between the two)
 */
export function StatusBadge({ receipt }: { receipt: ReceiptDTO }) {
  if (receipt.status === "void") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-muted/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        <span className="line-through">Void</span>
      </span>
    );
  }

  if (receipt.payment_status === "paid") {
    return (
      <span className="inline-flex items-center rounded-full bg-gold px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-cream">
        Paid
      </span>
    );
  }

  if (receipt.payment_status === "partial") {
    return (
      <span className="inline-flex items-center rounded-full border border-gold px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
        Partial
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-muted/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
      Pending
    </span>
  );
}
