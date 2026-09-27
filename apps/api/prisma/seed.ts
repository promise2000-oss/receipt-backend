/**
 * Seed data: one demo business with an owner login, a handful of customers
 * and enough receipts to exercise the dashboard, filters and PDF rendering.
 *
 *   npm run db:seed
 *
 * Safe to re-run — it skips anything that already exists.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { computeTotals } from "@eleos/shared";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@eleosstyles.com";
const DEMO_PASSWORD = "password123";

function daysAgo(days: number, hour = 11): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 24, 0, 0);
  return date;
}

async function main(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`[seed] "${DEMO_EMAIL}" already exists — nothing to do.`);
    return;
  }

  const business = await prisma.business.create({
    data: {
      name: "Eleosstyles Boutique",
      email: "hello@eleosstyles.com",
      phone: "+234 801 234 5678",
      address: "14 Admiralty Way, Lekki Phase 1, Lagos",
      currency: "NGN",
      brand_primary: "#111111",
      brand_accent: "#B8912F",
      number_prefix: "ES",
    },
  });

  const owner = await prisma.user.create({
    data: {
      business_id: business.id,
      full_name: "Ada Obi",
      email: DEMO_EMAIL,
      password_hash: await bcrypt.hash(DEMO_PASSWORD, 10),
      phone: "+234 801 234 5678",
      role: "owner",
    },
  });

  const customers = await Promise.all(
    [
      { name: "Chidinma Okafor", phone: "+234 803 555 0192", email: "chidinma@example.com" },
      { name: "Tunde Bakare", phone: "+234 806 111 7788", email: "tunde@example.com" },
      { name: "Zainab Yusuf", phone: "+234 809 444 2211", email: "zainab@example.com" },
      { name: "Emeka Nwosu", phone: "+234 812 900 3344", email: null },
    ].map((data) =>
      prisma.customer.create({ data: { business_id: business.id, ...data } }),
    ),
  );

  const seeds: Array<{
    customer: number | null;
    days: number;
    items: Array<{ description: string; quantity: number; unit_price: number }>;
    discount: number;
    taxRate: number;
    method: "cash" | "transfer" | "card" | "other";
    status: "paid" | "partial" | "pending";
  }> = [
    {
      customer: 0,
      days: 0,
      items: [
        { description: "Silk wrap dress — champagne", quantity: 1, unit_price: 48500 },
        { description: "Beaded clutch bag", quantity: 1, unit_price: 17500 },
      ],
      discount: 3000,
      taxRate: 7.5,
      method: "card",
      status: "paid",
    },
    {
      customer: 1,
      days: 0,
      items: [
        { description: "Ankara two-piece set", quantity: 2, unit_price: 32000 },
        { description: "Tailoring — hem adjustment", quantity: 2, unit_price: 4500 },
      ],
      discount: 0,
      taxRate: 7.5,
      method: "transfer",
      status: "paid",
    },
    {
      customer: 2,
      days: 1,
      items: [
        { description: "Cashmere shawl — ivory", quantity: 3, unit_price: 22000 },
        { description: "Gift wrapping", quantity: 3, unit_price: 1500 },
      ],
      discount: 5000,
      taxRate: 7.5,
      method: "cash",
      status: "partial",
    },
    {
      customer: 3,
      days: 2,
      items: [
        { description: "Beaded evening gown (bespoke)", quantity: 1, unit_price: 185000 },
      ],
      discount: 0,
      taxRate: 7.5,
      method: "transfer",
      status: "pending",
    },
    {
      customer: 0,
      days: 3,
      items: [
        { description: "Lace fabric — 5 yards", quantity: 5, unit_price: 9500 },
        { description: "Embellishment kit", quantity: 1, unit_price: 12000 },
      ],
      discount: 2500,
      taxRate: 7.5,
      method: "cash",
      status: "paid",
    },
    {
      customer: null,
      days: 5,
      items: [{ description: "Alteration — sleeve shortening", quantity: 1, unit_price: 8000 }],
      discount: 0,
      taxRate: 0,
      method: "cash",
      status: "paid",
    },
    {
      customer: 1,
      days: 8,
      items: [
        { description: "Organza maxi skirt", quantity: 1, unit_price: 41000 },
        { description: "Belt — gold buckle", quantity: 1, unit_price: 7500 },
      ],
      discount: 1000,
      taxRate: 7.5,
      method: "card",
      status: "paid",
    },
    {
      customer: 2,
      days: 12,
      items: [{ description: "Velvet blazer — black", quantity: 2, unit_price: 56000 }],
      discount: 0,
      taxRate: 7.5,
      method: "transfer",
      status: "paid",
    },
  ];

  for (const seed of seeds) {
    const totals = computeTotals(seed.items, seed.discount, seed.taxRate);
    const issue_date = daysAgo(seed.days);
    const paidAmount =
      seed.status === "paid"
        ? totals.total
        : seed.status === "partial"
          ? Math.round((totals.total / 2) * 100) / 100
          : 0;

    await prisma.$transaction(async (tx) => {
      const current = await tx.business.update({
        where: { id: business.id },
        data: { receipt_counter: { increment: 1 } },
        select: { receipt_counter: true, number_prefix: true },
      });

      await tx.receipt.create({
        data: {
          business_id: business.id,
          customer_id: seed.customer === null ? null : customers[seed.customer].id,
          receipt_number: `${current.number_prefix}-${String(current.receipt_counter).padStart(6, "0")}`,
          issue_date,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          tax_rate: seed.taxRate,
          total: totals.total,
          paid_amount: paidAmount,
          payment_method: seed.method,
          payment_status: seed.status,
          created_by: owner.id,
          items: {
            create: seed.items.map((item, index) => ({
              position: index,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              line_total: Math.round(item.quantity * item.unit_price * 100) / 100,
            })),
          },
        },
      });
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      "",
      "[seed] demo data created",
      `  business : ${business.name}`,
      `  login    : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
      `  receipts : ${seeds.length}`,
      "",
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
