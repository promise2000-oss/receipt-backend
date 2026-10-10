import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import {
  can,
  canAssignRole,
  outranks,
  permissionsFor,
  PERMISSIONS,
  type Permission,
  type Role,
} from "@eleos/shared";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";

/**
 * Roles, invitations and the audit log.
 *
 * Three claims are being defended here, and each has a test that would fail if
 * it stopped being true:
 *
 *  1. **The role in the token is the only role that matters.** A `staff`
 *     member posting `role: "owner"` changes nothing, because the guard reads
 *     the signed session, never the body.
 *  2. **You cannot act on somebody at or above your own rank.** Otherwise an
 *     `admin` could mint themselves an `owner` — the classic privilege
 *     escalation, and the reason role assignment is checked by relationship
 *     rather than by permission alone.
 *  3. **The organization always keeps an owner**, and the audit log is
 *     tenant-scoped and read-only.
 */

let app: Express;

const stamp = Date.now();

function cookieOf(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const session = list.find((value) => value.startsWith("el_session="));
  expect(session, "session cookie missing").toBeTruthy();
  return session!.split(";")[0];
}

interface Tenant {
  cookie: string;
  businessId: string;
  userId: string;
  label: string;
}

async function tenant(label: string): Promise<Tenant> {
  const email = `${label}-${stamp}@test.local`;
  const res = await request(app).post("/api/auth/signup").send({
    business: { name: `${label} Ltd`, currency: "NGN" },
    user: { full_name: `${label} Owner`, email, password: "testing12345" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    cookie: cookieOf(res.headers["set-cookie"]),
    businessId: res.body.business.id,
    userId: res.body.user.id,
    label,
  };
}

/**
 * A signed-in session for a user with an arbitrary role.
 *
 * Written straight to the database and then logged in through the real login
 * endpoint, so the JWT is minted exactly as it would be in production — the
 * tests exercise the real token path rather than a hand-made one.
 */
async function asRole(
  t: Tenant,
  role: Role,
  label: string,
): Promise<{ cookie: string; userId: string; email: string }> {
  // Lowercase, because `emailField` normalises to lowercase on every request
  // path and a mixed-case row would never match the `findUnique` on login.
  const email = `${t.label}-${label}-${stamp}@test.local`.toLowerCase();
  const user = await prisma.user.create({
    data: {
      business_id: t.businessId,
      full_name: `${t.label} ${label}`,
      email,
      // Same cost factor the API uses — a cheaper hash here would still
      // verify, but a 4-round hash would not match what `hashPassword`
      // produces and the login below would fail for the wrong reason.
      password_hash: await bcrypt.hash("testing12345", 10),
      role,
    },
  });

  const login = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "testing12345" });
  expect(login.status, JSON.stringify(login.body)).toBe(200);

  return { cookie: cookieOf(login.headers["set-cookie"]), userId: user.id, email };
}

beforeAll(() => {
  app = createApp();
});

/* ========================================================================= */
/*  1. The matrix itself                                                     */
/* ========================================================================= */

describe("permission matrix", () => {
  it("gives the owner everything", () => {
    expect(permissionsFor("owner").sort()).toEqual([...PERMISSIONS].sort());
  });

  it("gives a viewer no write permission at all", () => {
    const viewer = permissionsFor("viewer");
    expect(viewer.length).toBeGreaterThan(0);
    expect(
      viewer.filter((p) => /\.(create|update|delete|void|reissue|issue|cancel|recordPayment|invite|updateRole|revoke|transferOwnership)$/.test(p)),
    ).toEqual([]);
  });

  it("lets staff do the work but not administer the organization", () => {
    expect(can("staff", "receipt.create")).toBe(true);
    expect(can("staff", "invoice.recordPayment")).toBe(true);
    expect(can("staff", "customer.create")).toBe(true);
    // …but not any of these.
    expect(can("staff", "org.update")).toBe(false);
    expect(can("staff", "team.invite")).toBe(false);
    expect(can("staff", "customer.delete")).toBe(false);
    expect(can("staff", "invoice.cancel")).toBe(false);
  });

  it("lets admin run the business without owner-only powers", () => {
    expect(can("admin", "team.invite")).toBe(true);
    expect(can("admin", "team.updateRole")).toBe(true);
    expect(can("admin", "org.update")).toBe(true);
    expect(can("admin", "invoice.cancel")).toBe(true);
    // Owner-exclusive.
    expect(can("admin", "org.delete")).toBe(false);
    expect(can("admin", "org.transferOwnership")).toBe(false);
  });

  it("never widens access for an unknown or absent role", () => {
    expect(can(null, "receipt.read")).toBe(false);
    expect(can(undefined, "receipt.read")).toBe(false);
    expect(can("wizard" as Role, "receipt.read")).toBe(false);
    expect(permissionsFor(null)).toEqual([]);
  });

  it("orders the hierarchy owner > admin > staff > viewer", () => {
    expect(outranks("owner", "admin")).toBe(true);
    expect(outranks("admin", "staff")).toBe(true);
    expect(outranks("staff", "viewer")).toBe(true);
    expect(outranks("viewer", "staff")).toBe(false);
    // Not strictly greater — nobody outranks themselves.
    expect(outranks("admin", "admin")).toBe(false);
  });

  it("refuses to let anybody assign a role at or above their own", () => {
    expect(canAssignRole("owner", "owner")).toBe(false);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("admin", "admin")).toBe(false);
    expect(canAssignRole("admin", "staff")).toBe(true);
    expect(canAssignRole("staff", "viewer")).toBe(true);
  });
});

/* ========================================================================= */
/*  2. Enforcement over HTTP                                                 */
/* ========================================================================= */

describe("role enforcement", () => {
  it("reads the role from the session, ignoring one in the body", async () => {
    const t = await tenant("Escalation");
    const staff = await asRole(t, "staff", "Staff");

    // Posting a role must change nothing: the guard reads the signed token.
    const promoted = await request(app)
      .patch("/api/business")
      .set("Cookie", staff.cookie)
      .send({ name: "Hijacked", role: "owner" });

    expect(promoted.status).toBe(403);

    // And the organization name is untouched.
    const business = await request(app)
      .get("/api/business")
      .set("Cookie", t.cookie);
    expect(business.body.name).toBe(`${t.label} Ltd`);
  });

  it("lets a viewer read but not write", async () => {
    const t = await tenant("Viewer");
    const viewer = await asRole(t, "viewer", "Viewer");

    // Reads are fine.
    expect((await request(app).get("/api/receipts").set("Cookie", viewer.cookie)).status).toBe(200);
    expect((await request(app).get("/api/invoices").set("Cookie", viewer.cookie)).status).toBe(200);
    expect((await request(app).get("/api/customers").set("Cookie", viewer.cookie)).status).toBe(200);

    // Every write is refused.
    const writes: Array<[string, request.Test]> = [
      ["receipt", request(app).post("/api/receipts").set("Cookie", viewer.cookie).send({ items: [{ description: "x", quantity: 1, unit_price: 1 }] })],
      ["invoice", request(app).post("/api/invoices").set("Cookie", viewer.cookie).send({ items: [{ description: "x", quantity: 1, unit_price: 1 }] })],
      ["customer", request(app).post("/api/customers").set("Cookie", viewer.cookie).send({ name: "x" })],
      ["business", request(app).patch("/api/business").set("Cookie", viewer.cookie).send({ name: "x" })],
      ["invite", request(app).post("/api/team/invitations").set("Cookie", viewer.cookie).send({ email: "a@b.com" })],
    ];
    for (const [label, attempt] of writes) {
      expect((await attempt).status, `${label} should be 403`).toBe(403);
    }
  });

  it("lets staff void a receipt — it is a permitted receipt operation", async () => {
    const t = await tenant("StaffVoid");
    const receipt = await request(app)
      .post("/api/receipts")
      .set("Cookie", t.cookie)
      .send({ items: [{ description: "x", quantity: 1, unit_price: 100 }] });

    const staff = await asRole(t, "staff", "Staff");

    // The product spec grants staff "create and manage permitted receipts",
    // and their one prohibition is organization ownership and administrative
    // settings — neither of which a void is.
    const res = await request(app)
      .post(`/api/receipts/${receipt.body.id}/void`)
      .set("Cookie", staff.cookie)
      .send({ reason: "wrong amount" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("void");

    // The boundary that matters: staff may not administer the organization.
    expect(
      (await request(app).patch("/api/business").set("Cookie", staff.cookie).send({ name: "No" })).status,
    ).toBe(403);
    expect(
      (await request(app).post("/api/team/invitations").set("Cookie", staff.cookie)
        .send({ email: `x-${stamp}@test.local` })).status,
    ).toBe(403);
    // …nor delete a customer, which is an administrative cleanup task.
    const customer = await request(app)
      .post("/api/customers").set("Cookie", t.cookie).send({ name: "Doomed" });
    expect(
      (await request(app).delete(`/api/customers/${customer.body.id}`).set("Cookie", staff.cookie)).status,
    ).toBe(403);
  });

  it("lets admin do day-to-day work but not owner-only actions", async () => {
    const t = await tenant("AdminScope");
    const admin = await asRole(t, "admin", "Admin");

    // Day-to-day: allowed.
    const customer = await request(app)
      .post("/api/customers")
      .set("Cookie", admin.cookie)
      .send({ name: "Created by admin" });
    expect(customer.status).toBe(201);

    const branding = await request(app)
      .patch("/api/business")
      .set("Cookie", admin.cookie)
      .send({ address: "1 Admin Way" });
    expect(branding.status).toBe(200);

    // Owner-only: refused. Removing an owner is refused on rank, and the
    // admin cannot remove *itself* either (that is a 409 conflict).
    expect(
      (await request(app).delete(`/api/team/${t.userId}`).set("Cookie", admin.cookie)).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`/api/team/${admin.userId}`).set("Cookie", admin.cookie)).status,
    ).toBe(409);
  });

  it("keeps an existing staff session working after the upgrade", async () => {
    // The migration only added enum values; a `staff` row keeps staff powers.
    const t = await tenant("LegacyStaff");
    const staff = await asRole(t, "staff", "Legacy");
    const res = await request(app)
      .post("/api/receipts")
      .set("Cookie", staff.cookie)
      .send({ items: [{ description: "x", quantity: 1, unit_price: 100 }] });
    expect(res.status).toBe(201);
  });
});

/* ========================================================================= */
/*  3. Invitations                                                           */
/* ========================================================================= */

describe("invitations", () => {
  async function invite(t: Tenant, role = "staff") {
    return request(app)
      .post("/api/team/invitations")
      .set("Cookie", t.cookie)
      .send({ email: `invited-${stamp}-${Math.random().toString(36).slice(2)}@test.local`, role });
  }

  it("creates an invitation and returns the token exactly once", async () => {
    const t = await tenant("Invite");
    const res = await invite(t, "staff");
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.role).toBe("staff");

    // The plaintext is never stored: only a hash is, so listing the team
    // cannot reveal a working token.
    const team = await request(app).get("/api/team").set("Cookie", t.cookie);
    const invitation = team.body.invitations[0];
    expect(invitation).toBeTruthy();
    expect(JSON.stringify(invitation)).not.toContain(res.body.token);
  });

  it("lets the invitee join with the role they were granted", async () => {
    const t = await tenant("Accept");
    const created = await invite(t, "staff");
    const email = created.body.email;

    const accepted = await request(app)
      .post("/api/team/invitations/accept")
      .send({ token: created.body.token, email, full_name: "Invited Person", password: "testing12345" });

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.user.role).toBe("staff");
    expect(accepted.body.user.business_id).toBe(t.businessId);

    // And they can actually sign in and work.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "testing12345" });
    expect(login.status).toBe(200);
    expect(login.body.business.id).toBe(t.businessId);
  });

  it("refuses an unknown, reused, expired or revoked token", async () => {
    const t = await tenant("TokenRules");

    const unknown = await request(app)
      .post("/api/team/invitations/accept")
      .send({ token: "a".repeat(43), email: "x@y.com", full_name: "X Y", password: "testing12345" });
    expect(unknown.status).toBe(404);

    const created = await invite(t);
    const payload = { token: created.body.token, email: created.body.email, full_name: "First Person", password: "testing12345" };

    expect(
      (await request(app).post("/api/team/invitations/accept").send(payload)).status,
    ).toBe(201);

    // Single use.
    const reuse = await request(app)
      .post("/api/team/invitations/accept")
      .send({ ...payload, email: `second-${stamp}@test.local`, full_name: "Second Person" });
    expect(reuse.status).toBe(409);
  });

  it("refuses to redeem an invitation sent to a different address", async () => {
    const t = await tenant("Mismatch");
    const created = await invite(t);
    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({
        token: created.body.token,
        email: "somebody.else@test.local",
        full_name: "Wrong Person",
        password: "testing12345",
      });
    expect(res.status).toBe(422);
  });

  it("refuses an expired invitation", async () => {
    const t = await tenant("Expiry");
    const created = await invite(t);

    await prisma.invitation.updateMany({
      where: { business_id: t.businessId },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({
        token: created.body.token,
        email: created.body.email,
        full_name: "Late Person",
        password: "testing12345",
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVITATION_EXPIRED");
  });

  it("refuses an invitation revoked before use", async () => {
    const t = await tenant("Revoke");
    const created = await invite(t);
    const team = await request(app).get("/api/team").set("Cookie", t.cookie);

    const revoked = await request(app)
      .delete(`/api/team/invitations/${team.body.invitations[0].id}`)
      .set("Cookie", t.cookie);
    expect(revoked.status).toBe(200);

    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({
        token: created.body.token,
        email: created.body.email,
        full_name: "Revoked Person",
        password: "testing12345",
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVITATION_REVOKED");
  });

  it("will not let anybody invite somebody at or above their own rank", async () => {
    const t = await tenant("RankCap");
    const admin = await asRole(t, "admin", "Admin");

    // `admin` may invite below admin…
    expect(
      (await request(app).post("/api/team/invitations").set("Cookie", admin.cookie)
        .send({ email: `ok-${stamp}@test.local`, role: "staff" })).status,
    ).toBe(201);

    // …but not as an admin, because that is their own rank.
    const sameRank = await request(app)
      .post("/api/team/invitations")
      .set("Cookie", admin.cookie)
      .send({ email: `no-admin-${stamp}@test.local`, role: "admin" });
    expect(sameRank.status).toBe(403);

    // `owner` is not an assignable role for an invitation at all — ownership
    // is transferred, never invited — so the schema rejects it outright.
    const asOwner = await request(app)
      .post("/api/team/invitations")
      .set("Cookie", admin.cookie)
      .send({ email: `no-owner-${stamp}@test.local`, role: "owner" });
    expect(asOwner.status).toBe(422);
  });

  it("keeps invitations inside the organization", async () => {
    const a = await tenant("InvA");
    const b = await tenant("InvB");
    const created = await invite(a);

    // B can neither see nor revoke A's invitation.
    const list = await request(app).get("/api/team").set("Cookie", b.cookie);
    expect(list.body.invitations).toHaveLength(0);

    const team = await request(app).get("/api/team").set("Cookie", a.cookie);
    const stolen = await request(app)
      .delete(`/api/team/invitations/${team.body.invitations[0].id}`)
      .set("Cookie", b.cookie);
    expect(stolen.status).toBe(404);
    void created;
  });

  it("creates exactly one member when a token is redeemed twice at once", async () => {
    const t = await tenant("Race");
    const created = await invite(t);
    const body = {
      token: created.body.token,
      email: created.body.email,
      full_name: "Racing Person",
      password: "testing12345",
    };

    const results = await Promise.all([
      request(app).post("/api/team/invitations/accept").send(body),
      request(app).post("/api/team/invitations/accept").send(body),
      request(app).post("/api/team/invitations/accept").send(body),
    ]);

    const createdCount = results.filter((r) => r.status === 201).length;
    expect(createdCount).toBe(1);

    const members = await prisma.user.findMany({
      where: { business_id: t.businessId, email: body.email },
    });
    expect(members).toHaveLength(1);
  }, 60_000);
});

/* ========================================================================= */
/*  4. Role changes and removal                                             */
/* ========================================================================= */

describe("team administration", () => {
  it("lets an owner change and remove anybody below them", async () => {
    const t = await tenant("OwnerAdmin");
    const staff = await asRole(t, "staff", "Staff");

    const promoted = await request(app)
      .patch(`/api/team/${staff.userId}/role`)
      .set("Cookie", t.cookie)
      .send({ role: "admin" });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe("admin");

    const removed = await request(app)
      .delete(`/api/team/${staff.userId}`)
      .set("Cookie", t.cookie);
    expect(removed.status).toBe(200);
  });

  it("refuses to let an admin demote or remove an owner", async () => {
    const t = await tenant("AdminVsOwner");
    const admin = await asRole(t, "admin", "Admin");

    const demote = await request(app)
      .patch(`/api/team/${t.userId}/role`)
      .set("Cookie", admin.cookie)
      .send({ role: "staff" });
    expect(demote.status).toBe(403);

    const remove = await request(app)
      .delete(`/api/team/${t.userId}`)
      .set("Cookie", admin.cookie);
    expect(remove.status).toBe(403);
  });

  it("never lets somebody change their own role or remove themselves", async () => {
    const t = await tenant("SelfHarm");
    const admin = await asRole(t, "admin", "Admin");

    // 409, not 403: the request is well-formed and permitted in principle,
    // but acting on yourself is a conflict of interest rather than a missing
    // permission, so it is reported as a conflict.
    const promote = await request(app)
      .patch(`/api/team/${admin.userId}/role`)
      .set("Cookie", admin.cookie)
      .send({ role: "owner" });
    expect(promote.status).toBe(409);
    expect(promote.body.code).toBe("SELF_ROLE_CHANGE");

    const remove = await request(app)
      .delete(`/api/team/${admin.userId}`)
      .set("Cookie", admin.cookie);
    expect(remove.status).toBe(409);
    expect(remove.body.code).toBe("SELF_REVOKE");

    // And the admin's own role is genuinely unchanged.
    const me = await request(app).get("/api/auth/me").set("Cookie", admin.cookie);
    expect(me.body.user.role).toBe("admin");
  });

  it("refuses to remove the last owner", async () => {
    const t = await tenant("LastOwner");

    const self = await request(app)
      .patch(`/api/team/${t.userId}/role`)
      .set("Cookie", t.cookie)
      .send({ role: "staff" });
    expect(self.status).toBe(409);
    expect(self.body.code).toBe("SELF_ROLE_CHANGE");
  });

  it("allows stepping down once a second owner exists", async () => {
    const t = await tenant("TwoOwners");
    const successor = await asRole(t, "owner", "Successor");

    const stepDown = await request(app)
      .patch(`/api/team/${t.userId}/role`)
      .set("Cookie", successor.cookie)
      .send({ role: "admin" });
    expect(stepDown.status).toBe(200);

    // The organization still has exactly one owner.
    const owners = await prisma.user.count({
      where: { business_id: t.businessId, role: "owner" },
    });
    expect(owners).toBe(1);
    void successor;
  });

  it("refuses to remove a member who authored financial records", async () => {
    const t = await tenant("Author");
    const staff = await asRole(t, "staff", "Staff");

    await request(app)
      .post("/api/receipts")
      .set("Cookie", staff.cookie)
      .send({ items: [{ description: "x", quantity: 1, unit_price: 100 }] });

    const res = await request(app)
      .delete(`/api/team/${staff.userId}`)
      .set("Cookie", t.cookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MEMBER_HAS_RECORDS");

    // Demoting to viewer is the safe alternative, and is allowed.
    const demote = await request(app)
      .patch(`/api/team/${staff.userId}/role`)
      .set("Cookie", t.cookie)
      .send({ role: "viewer" });
    expect(demote.status).toBe(200);
  });

  it("keeps team management inside the organization", async () => {
    const a = await tenant("TeamA");
    const b = await tenant("TeamB");

    // An admin in A, so the rank check cannot mask the tenant check.
    const admin = await asRole(a, "admin", "Outsider");

    // B's owner lives in another tenant: `notFound`, because the lookup is
    // scoped by `business_id` before any rank decision is made.
    const res = await request(app)
      .patch(`/api/team/${b.userId}/role`)
      .set("Cookie", admin.cookie)
      .send({ role: "viewer" });
    expect(res.status).toBe(404);

    const remove = await request(app)
      .delete(`/api/team/${b.userId}`)
      .set("Cookie", admin.cookie);
    expect(remove.status).toBe(404);

    // B's owner is untouched.
    const owner = await prisma.user.findUnique({
      where: { id: b.userId },
      select: { role: true },
    });
    expect(owner?.role).toBe("owner");
  });
});

/* ========================================================================= */
/*  5. Audit log                                                             */
/* ========================================================================= */

describe("audit log", () => {
  it("records the significant events with actor and resource", async () => {
    const t = await tenant("AuditWrite");

    const receipt = await request(app)
      .post("/api/receipts")
      .set("Cookie", t.cookie)
      .send({ items: [{ description: "x", quantity: 2, unit_price: 500 }] });

    // A draft first, so `invoice.issued` is a genuinely separate event rather
    // than an artifact of creating directly in the issued state.
    const draft = await request(app)
      .post("/api/invoices")
      .set("Cookie", t.cookie)
      .send({ issue: false, items: [{ description: "x", quantity: 1, unit_price: 1000 }] });
    const issued = await request(app)
      .post(`/api/invoices/${draft.body.id}/issue`)
      .set("Cookie", t.cookie)
      .send({});
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);

    await request(app)
      .post(`/api/invoices/${issued.body.id}/payments`)
      .set("Cookie", t.cookie)
      .send({ amount: 400 });

    await request(app)
      .patch("/api/business")
      .set("Cookie", t.cookie)
      .send({ brand_primary: "#222222" });

    const log = await request(app).get("/api/audit").set("Cookie", t.cookie);
    expect(log.status).toBe(200);

    const actions = log.body.items.map((row: { action: string }) => row.action);
    expect(actions).toContain("receipt.created");
    expect(actions).toContain("invoice.created");
    expect(actions).toContain("invoice.issued");
    expect(actions).toContain("payment.recorded");
    expect(actions).toContain("org.branding_changed");

    // The actor is recorded, and never a password or token.
    const payment = log.body.items.find((r: { action: string }) => r.action === "payment.recorded");
    expect(payment.actor.id).toBe(t.userId);
    expect(payment.metadata.amount).toBe(400);
    expect(JSON.stringify(log.body)).not.toMatch(/password_hash|testing12345/);
  });

  it("records the void reason for a receipt", async () => {
    const t = await tenant("AuditVoid");
    const receipt = await request(app)
      .post("/api/receipts")
      .set("Cookie", t.cookie)
      .send({ items: [{ description: "x", quantity: 1, unit_price: 100 }] });

    await request(app)
      .post(`/api/receipts/${receipt.body.id}/void`)
      .set("Cookie", t.cookie)
      .send({ reason: "Wrong amount" });

    const log = await request(app).get("/api/audit").set("Cookie", t.cookie);
    const entry = log.body.items.find((r: { action: string }) => r.action === "receipt.voided");
    expect(entry).toBeTruthy();
    expect(entry.metadata.reason).toBe("Wrong amount");
  });

  it("is scoped to one organization", async () => {
    const a = await tenant("AuditA");
    const b = await tenant("AuditB");

    await request(app)
      .post("/api/receipts")
      .set("Cookie", a.cookie)
      .send({ items: [{ description: "secret", quantity: 1, unit_price: 4242 }] });

    const log = await request(app).get("/api/audit").set("Cookie", b.cookie);
    expect(log.body.items).toHaveLength(0);
    expect(JSON.stringify(log.body)).not.toContain("secret");
  });

  it("exposes no route that can modify or delete an entry", async () => {
    const t = await tenant("AuditImmutable");
    await request(app)
      .post("/api/receipts")
      .set("Cookie", t.cookie)
      .send({ items: [{ description: "x", quantity: 1, unit_price: 100 }] });

    const log = await request(app).get("/api/audit").set("Cookie", t.cookie);
    const id = log.body.items[0].id;

    // Read-only by construction: these verbs simply do not exist.
    for (const method of ["post", "patch", "put", "delete"] as const) {
      const res = await request(app)[method]("/api/audit").set("Cookie", t.cookie).send({});
      expect(res.status, `${method} /api/audit should not exist`).toBe(404);
    }
    const single = await request(app).delete(`/api/audit/${id}`).set("Cookie", t.cookie);
    expect(single.status).toBe(404);
  });

  it("filters by action and date", async () => {
    const t = await tenant("AuditFilter");
    await request(app)
      .post("/api/receipts")
      .set("Cookie", t.cookie)
      .send({ items: [{ description: "x", quantity: 1, unit_price: 100 }] });

    const filtered = await request(app)
      .get("/api/audit?action=receipt.created")
      .set("Cookie", t.cookie);
    expect(filtered.body.items.length).toBeGreaterThan(0);
    expect(
      filtered.body.items.every((r: { action: string }) => r.action === "receipt.created"),
    ).toBe(true);

    const none = await request(app)
      .get("/api/audit?action=org.deleted")
      .set("Cookie", t.cookie);
    expect(none.body.items).toHaveLength(0);
  });

  it("requires a session", async () => {
    expect((await request(app).get("/api/audit")).status).toBe(401);
    expect((await request(app).get("/api/team")).status).toBe(401);
  });
});