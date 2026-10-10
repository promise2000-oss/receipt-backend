-- Invoicing, payment tracking and document watermarking.
--
-- Purely additive: no existing receipt, customer, user or business row is
-- read, rewritten or deleted here, so the upgrade is safe to run against a
-- live database. Every new column carries a DEFAULT, which backfills the
-- rows that already exist:
--
--   receipts.source            → 'standalone' for every receipt issued before
--                               invoicing existed, so history keeps rendering
--                               exactly as it did.
--   receipts.invoice_payment_id → NULL (no payment, no link).
--   businesses.invoice_counter  → 0 (the first invoice will be INV-000001).
--   businesses.watermark_*      → on, 'VISIONARYGENE', 8% — the platform
--                               default every organization inherits.

-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('standalone', 'invoice_payment');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "invoice_counter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "watermark_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "watermark_opacity" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "watermark_text" TEXT NOT NULL DEFAULT 'VISIONARYGENE';

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "invoice_payment_id" TEXT,
ADD COLUMN     "source" "ReceiptSource" NOT NULL DEFAULT 'standalone';

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "invoice_number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "terms" TEXT,
    "po_reference" TEXT,
    "pdf_url" TEXT,
    "issued_snapshot" JSONB,
    "issued_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "reference" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_business_id_created_at_idx" ON "invoices"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_business_id_status_idx" ON "invoices"("business_id", "status");

-- CreateIndex
CREATE INDEX "invoices_business_id_issue_date_idx" ON "invoices"("business_id", "issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_invoice_number_key" ON "invoices"("business_id", "invoice_number");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_payments_business_id_created_at_idx" ON "invoice_payments"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_paid_at_idx" ON "invoice_payments"("invoice_id", "paid_at");

-- One payment yields at most one receipt. This unique index is what makes a
-- duplicated receipt impossible even if two requests race to generate it.
CREATE UNIQUE INDEX "receipts_invoice_payment_id_key" ON "receipts"("invoice_payment_id");

-- CreateIndex
CREATE INDEX "receipts_invoice_payment_id_idx" ON "receipts"("invoice_payment_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_payment_id_fkey" FOREIGN KEY ("invoice_payment_id") REFERENCES "invoice_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;