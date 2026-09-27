-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'staff');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'transfer', 'card', 'other');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('paid', 'partial', 'pending');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('active', 'void');

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo_url" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "brand_primary" TEXT NOT NULL DEFAULT '#111111',
    "brand_accent" TEXT NOT NULL DEFAULT '#B8912F',
    "number_prefix" TEXT NOT NULL DEFAULT 'ES',
    "receipt_counter" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "receipt_number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'paid',
    "status" "ReceiptStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "pdf_url" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "original_receipt_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_items" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_business_id_idx" ON "users"("business_id");

-- CreateIndex
CREATE INDEX "customers_business_id_idx" ON "customers"("business_id");

-- CreateIndex
CREATE INDEX "customers_business_id_name_idx" ON "customers"("business_id", "name");

-- CreateIndex
CREATE INDEX "receipts_business_id_created_at_idx" ON "receipts"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "receipts_business_id_status_idx" ON "receipts"("business_id", "status");

-- CreateIndex
CREATE INDEX "receipts_business_id_issue_date_idx" ON "receipts"("business_id", "issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_business_id_receipt_number_key" ON "receipts"("business_id", "receipt_number");

-- CreateIndex
CREATE INDEX "receipt_items_receipt_id_idx" ON "receipt_items"("receipt_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_original_receipt_id_fkey" FOREIGN KEY ("original_receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
