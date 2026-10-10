import crypto from "node:crypto";
import { Router } from "express";
import { canAssignRole, ROLE_LABELS, ROLES, type Role } from "@eleos/shared";
import { prisma } from "../lib/prisma";
import { AppError, conflict, notFound } from "../lib/errors";
import { asyncH, parse, pathParam } from "../middleware/validate";
import { emailField } from "@eleos/shared";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/requireAuth";
import { record, AUDIT_ACTIONS } from "../lib/audit";
import { toUserDTO } from "../mappers";

/**
 * Team management and invitations.
 *
 * Single-organization by design: a user belongs to exactly one organization
 * (`users.business_id`), and an invitation is a request to join *that* one.
 * There is no Membership table and no organization switcher — the JWT carries
 * one `businessId`, so this module is the whole of team management rather
 * than half of it.
 *
 * Two rules are enforced here rather than in the permission matrix, because
 * both are about *relationships*, not about what a role may generally do:
 *
 *  - **You may only act on someone you outrank.** A role can be assigned or
 *    revoked only against a lower rank, so an `admin` cannot touch an
 *    `owner` and a `staff` member cannot touch anybody.
 *  - **The organization always keeps an owner.** Demoting or removing the
 *    last owner would leave nobody able to manage the workspace, so it is
 *    refused.
 */

export const teamRouter = Router();

/**
 * Read access to the team list requires a session; the accept route does not.
 *
 * `teamRouter.use(requireAuth)` would push the unauthenticated redemption
 * behind the auth guard, so the session requirement is applied per-route
 * instead. That is the one route in this module without a session, and it is
 * listed explicitly below so the exception is visible rather than implied.
 */
const requireSession = requireAuth;


/** How long an invitation stays redeemable. */
const INVITE_TTL_HOURS = 72;

/**
 * The token is stored only as a SHA-256 hash.
 *
 * A leaked database row is therefore useless to an attacker: the plaintext
 * exists once, in the response to the person who created the invite. The hash
 * is not salted per-row, which is correct here — the input is 256 bits of
 * `randomBytes`, so there is nothing to brute-force, and a per-row salt would
 * only stop identical tokens hashing alike (which we do not need to hide).
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const inviteSchema = z.object({
  email: emailField("Email"),
  /**
   * Capped at `admin`. Ownership is transferred, not invited — see
   * `POST /team/:id/role` and the owner-only transfer route.
   */
  role: z
    .enum(["admin", "staff", "viewer"] as [string, ...string[]])
    .default("staff"),
});

const roleSchema = z.object({
  role: z.enum(["owner", "admin", "staff", "viewer"] as [string, ...string[]]),
});

const inviteByTokenSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

/* ---------------------------------------------------------------------------
 * Read
 * ------------------------------------------------------------------------ */

teamRouter.get(
  "/",
  requireSession,
  requirePermission("team.read"),
  asyncH(async (req, res) => {
    const members = await prisma.user.findMany({
      where: { business_id: req.auth!.businessId },
      orderBy: [{ role: "asc" }, { created_at: "asc" }],
    });

    const invitations = await prisma.invitation.findMany({
      where: {
        business_id: req.auth!.businessId,
        accepted_at: null,
        revoked_at: null,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: "desc" },
    });

    res.json({
      members: members.map((member) => toUserDTO(member)),
      invitations: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        invited_by: invitation.invited_by,
        expires_at: invitation.expires_at.toISOString(),
        created_at: invitation.created_at.toISOString(),
      })),
      /** Mirrors the shared matrix so the UI hides what the API would refuse. */
      assignable_roles: ROLES.filter((role) =>
        canAssignRole(req.auth!.role, role),
      ),
    });
  }),
);

/* ---------------------------------------------------------------------------
 * Invite
 * ------------------------------------------------------------------------ */

teamRouter.post(
  "/invitations",
  requireSession,
  requirePermission("team.invite"),
  asyncH(async (req, res) => {
    const input = parse(inviteSchema, req.body);
    const actor = req.auth!;

    // The matrix grants `team.invite` to admin and owner, but the *target*
    // role is a separate question: nobody may mint somebody at or above their
    // own rank.
    if (!canAssignRole(actor.role, input.role as Role)) {
      throw new AppError(
        `You can't invite somebody as ${ROLE_LABELS[input.role as Role]} — that role is at or above your own.`,
        403,
        "FORBIDDEN",
      );
    }

    const existingMember = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, business_id: true },
    });
    if (existingMember) {
      throw conflict(
        existingMember.business_id === actor.businessId
          ? "That person is already on your team."
          : "That email is already registered to another organization.",
        "ALREADY_MEMBER",
      );
    }

    const previous = await prisma.invitation.findUnique({
      where: { business_id_email: { business_id: actor.businessId, email: input.email } },
    });
    if (previous && !previous.accepted_at && !previous.revoked_at && previous.expires_at > new Date()) {
      throw conflict(
        "There is already a pending invitation for that address.",
        "INVITATION_EXISTS",
      );
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    const invitation = await prisma.$transaction(async (tx) => {
      // Re-inviting supersedes the old row rather than failing on the unique
      // index — a stale invite should be replaceable, not a dead end.
      if (previous) {
        await tx.invitation.update({
          where: { id: previous.id },
          data: { revoked_at: new Date() },
        });
      }

      return tx.invitation.create({
        data: {
          business_id: actor.businessId,
          email: input.email,
          role: input.role as never,
          token_hash: hashToken(token),
          invited_by: actor.userId,
          expires_at: expiresAt,
        },
      });
    });

    await record({
      businessId: actor.businessId,
      actorId: actor.userId,
      action: AUDIT_ACTIONS.teamInvited,
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { email: invitation.email, role: invitation.role },
    });

    res.status(201).json({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expires_at: invitation.expires_at.toISOString(),
      /**
       * The plaintext token, returned exactly once. There is no endpoint that
       * can retrieve it later, so a caller that loses it must re-invite.
       */
      token,
      accept_url: `/accept-invite?token=${token}`,
    });
  }),
);

teamRouter.delete(
  "/invitations/:id",
  requireSession,
  requirePermission("team.invite"),
  asyncH(async (req, res) => {
    const businessId = req.auth!.businessId;
    const id = pathParam(req, "id");

    const existing = await prisma.invitation.findFirst({
      where: { id, business_id: businessId },
    });
    if (!existing) throw notFound("Invitation");
    if (existing.accepted_at) {
      throw conflict("That invitation has already been accepted.", "ALREADY_ACCEPTED");
    }
    if (existing.revoked_at) {
      throw conflict("That invitation has already been revoked.", "ALREADY_REVOKED");
    }

    await prisma.invitation.update({
      where: { id: existing.id },
      data: { revoked_at: new Date() },
    });

    await record({
      businessId,
      actorId: req.auth!.userId,
      action: AUDIT_ACTIONS.teamInvitationRevoked,
      resourceType: "invitation",
      resourceId: existing.id,
      metadata: { email: existing.email },
    });

    res.json({ ok: true });
  }),
);

/* ---------------------------------------------------------------------------
 * Accept — the only unauthenticated team route
 * ------------------------------------------------------------------------ */

/**
 * Redeem an invitation.
 *
 * No session is required — the token *is* the authorisation — so this router
 * cannot sit behind `requireAuth`. It is therefore mounted with its own
 * per-route guard and does exactly three things: validates the token, creates
 * the user, marks the invitation used.
 *
 * Concurrency matters here. Two simultaneous redemptions of the same token
 * must produce one member, not two, so the invitation row is claimed with a
 * conditional update (`accepted_at IS NULL`) and the loser is rejected.
 */
teamRouter.post(
  "/invitations/accept",
  asyncH(async (req, res) => {
    const input = parse(inviteByTokenSchema, req.body);

    // Look up by hash: the plaintext never touched the database.
    const invitation = await prisma.invitation.findUnique({
      where: { token_hash: hashToken(input.token) },
    });

    if (!invitation) {
      throw new AppError("That invitation is not valid.", 404, "INVITATION_INVALID");
    }
    if (invitation.revoked_at) {
      throw new AppError("That invitation was revoked.", 409, "INVITATION_REVOKED");
    }
    if (invitation.accepted_at) {
      throw new AppError("That invitation has already been used.", 409, "INVITATION_USED");
    }
    if (invitation.expires_at <= new Date()) {
      throw new AppError(
        "That invitation has expired. Ask for a new one.",
        409,
        "INVITATION_EXPIRED",
      );
    }

    const password = z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(200)
      .safeParse((req.body as Record<string, unknown>).password);
    if (!password.success) {
      throw new AppError(
        "Please correct the highlighted fields.",
        422,
        "VALIDATION_ERROR",
        { password: password.error.issues[0]?.message ?? "Invalid password" },
      );
    }

    const name = z
      .object({
        full_name: z.string().trim().min(2, "Your name is required").max(120),
        email: emailField(),
      })
      .safeParse(req.body);
    if (!name.success) {
      throw new AppError(
        "Please correct the highlighted fields.",
        422,
        "VALIDATION_ERROR",
        Object.fromEntries(
          name.error.issues.map((issue) => [issue.path.join(".") || "_", issue.message]),
        ),
      );
    }

    if (name.data.email !== invitation.email) {
      throw new AppError(
        "This invitation was sent to a different email address.",
        422,
        "INVITATION_EMAIL_MISMATCH",
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email: name.data.email },
      select: { id: true },
    });
    if (existing) {
      throw conflict("An account with that email already exists.", "EMAIL_TAKEN");
    }

    // Hashing before the transaction keeps the lock short.
    const { hashPassword } = await import("../lib/auth");
    const passwordHash = await hashPassword(password.data);

    const user = await prisma.$transaction(async (tx) => {
      // Claim the invitation. `updateMany` with the `accepted_at IS NULL`
      // condition is the atomic gate: exactly one concurrent request can
      // report count === 1.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, accepted_at: null },
        data: { accepted_at: new Date(), accepted_by: null },
      });
      if (claimed.count !== 1) {
        throw conflict("That invitation has already been used.", "INVITATION_USED");
      }

      const created = await tx.user.create({
        data: {
          business_id: invitation.business_id,
          full_name: name.data.full_name,
          email: name.data.email,
          password_hash: passwordHash,
          role: invitation.role,
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { accepted_by: created.id },
      });

      return created;
    });

    await record({
      businessId: invitation.business_id,
      actorId: user.id,
      action: AUDIT_ACTIONS.teamInvitationAccepted,
      resourceType: "user",
      resourceId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    res.status(201).json({
      user: toUserDTO(user),
      /** No session is minted — the invitee signs in like anyone else. */
    });
  }),
);

/* ---------------------------------------------------------------------------
 * Change role / remove
 * ------------------------------------------------------------------------ */

teamRouter.patch(
  "/:id/role",
  requireSession,
  requirePermission("team.updateRole"),
  asyncH(async (req, res) => {
    const actor = req.auth!;
    const id = pathParam(req, "id");
    const input = parse(roleSchema, req.body);

    if (id === actor.userId) {
      throw new AppError(
        "You can't change your own role.",
        409,
        "SELF_ROLE_CHANGE",
      );
    }

    const target = await prisma.user.findFirst({
      where: { id, business_id: actor.businessId },
    });
    if (!target) throw notFound("Member");

    // Rank rule: you may act on anybody *strictly below* yourself, plus other
    // owners.
    //
    // The owner case is deliberate and is the one place peers are allowed to
    // act on each other. Without it, ownership handoff would be impossible:
    // two owners could never demote one another, so an organization could
    // never go from "two owners" back to "one". It grants no escalation,
    // because an owner already holds the top rank and `canAssignRole` on the
    // *target* role below still refuses anything at or above the actor.
    const peerOwner =
      actor.role === "owner" && target.role === "owner" && actor.userId !== target.id;

    if (!peerOwner && !canAssignRole(actor.role, target.role)) {
      throw new AppError(
        "You can only change the role of somebody below your own.",
        403,
        "FORBIDDEN",
      );
    }
    if (!canAssignRole(actor.role, input.role as Role)) {
      throw new AppError(
        `You can't grant ${ROLE_LABELS[input.role as Role]} — that role is at or above your own.`,
        403,
        "FORBIDDEN",
      );
    }

    // Never leave the organization ownerless.
    if (target.role === "owner" && input.role !== "owner") {
      const owners = await prisma.user.count({
        where: { business_id: actor.businessId, role: "owner" },
      });
      if (owners <= 1) {
        throw conflict(
          "This is the only owner. Give somebody else ownership before stepping down.",
          "LAST_OWNER",
        );
      }
    }

    const updated = await prisma.user.update({
      // `business_id` in the `where` is not decoration: the Prisma client
      // extension refuses a `user` write that omits it, so the tenant scope is
      // enforced here as well as by the lookup above.
      where: { id: target.id, business_id: actor.businessId },
      data: { role: input.role as never },
    });

    await record({
      businessId: actor.businessId,
      actorId: actor.userId,
      action: AUDIT_ACTIONS.teamRoleChanged,
      resourceType: "user",
      resourceId: updated.id,
      metadata: { email: updated.email, from: target.role, to: updated.role },
    });

    res.json(toUserDTO(updated));
  }),
);

teamRouter.delete(
  "/:id",
  requireSession,
  requirePermission("team.revoke"),
  asyncH(async (req, res) => {
    const actor = req.auth!;
    const id = pathParam(req, "id");

    if (id === actor.userId) {
      throw new AppError("You can't remove yourself.", 409, "SELF_REVOKE");
    }

    const target = await prisma.user.findFirst({
      where: { id, business_id: actor.businessId },
    });
    if (!target) throw notFound("Member");

    // Same peer rule as the role change: owners may remove other owners, so a
    // successor can be cleaned up. The self-check above already blocks an
    // owner removing themselves.
    const peerOwner =
      actor.role === "owner" && target.role === "owner" && actor.userId !== target.id;

    if (!peerOwner && !canAssignRole(actor.role, target.role)) {
      throw new AppError(
        "You can only remove somebody below your own role.",
        403,
        "FORBIDDEN",
      );
    }

    if (target.role === "owner") {
      const owners = await prisma.user.count({
        where: { business_id: actor.businessId, role: "owner" },
      });
      if (owners <= 1) {
        throw conflict(
          "This is the only owner — the organization would be left unmanaged.",
          "LAST_OWNER",
        );
      }
    }

    // Receipts and invoices keep their `created_by`, which is `ON DELETE
    // Restrict`. Refuse with a clear reason rather than surfacing a foreign
    // key error, and never cascade away a financial record.
    const authored = await prisma.receipt.count({ where: { created_by: target.id } });
    const raised = await prisma.invoice.count({ where: { created_by: target.id } });
    if (authored > 0 || raised > 0) {
      throw conflict(
        "That member has issued receipts or invoices. Demote them to Viewer instead of removing them, so the financial history keeps its author.",
        "MEMBER_HAS_RECORDS",
      );
    }

    await prisma.user.delete({
      where: { id: target.id, business_id: actor.businessId },
    });

    await record({
      businessId: actor.businessId,
      actorId: actor.userId,
      action: AUDIT_ACTIONS.teamMemberRemoved,
      resourceType: "user",
      resourceId: target.id,
      metadata: { email: target.email, role: target.role },
    });

    res.json({ ok: true });
  }),
);