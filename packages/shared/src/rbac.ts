/**
 * Role-based access control.
 *
 * Four roles, one permission matrix, defined here so the API and the UI cannot
 * disagree about who may do what. The backend is the only enforcement point —
 * this file exists so a client can *hide* a control it knows will be refused,
 * never so a client can *allow* one.
 *
 * The model is deliberately additive to the existing `owner`/`staff` pair:
 * `owner` and `staff` keep their current meaning, and `admin` and `viewer`
 * are inserted around them.
 */

export type Role = "owner" | "admin" | "staff" | "viewer";

export const ROLES: Role[] = ["owner", "admin", "staff", "viewer"];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full control, including billing, ownership transfer and deletion.",
  admin: "Runs day-to-day operations: team, receipts, invoices, customers and settings.",
  staff: "Issues receipts and records payments. Cannot change organization settings.",
  viewer: "Read-only. Cannot create, edit, delete or record anything.",
};

/**
 * Every discrete permission the product checks.
 *
 * Grouped by the resource it governs rather than by role, because that is how
 * a route asks the question ("may this actor `invoice.issue`?") and how an
 * audit log reads.
 */
export const PERMISSIONS = [
  /* Organization */
  "org.read",
  "org.update",
  "org.delete",
  "org.transferOwnership",

  /* Team */
  "team.read",
  "team.invite",
  "team.updateRole",
  "team.revoke",

  /* Customers */
  "customer.read",
  "customer.create",
  "customer.update",
  "customer.delete",

  /* Receipts */
  "receipt.read",
  "receipt.create",
  "receipt.void",
  "receipt.reissue",

  /* Invoices */
  "invoice.read",
  "invoice.create",
  "invoice.update",
  "invoice.issue",
  "invoice.cancel",
  "invoice.recordPayment",

  /* Reporting */
  "report.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The matrix.
 *
 * Expressed as "what this role *adds*" rather than as a full list per role,
 * so adding a permission never means re-typing four rows and never risks
 * silently widening the other three. `owner` is resolved to the full set in
 * code below.
 */
const GRANTS: Record<Exclude<Role, "owner">, readonly Permission[]> = {
  /* ADMIN — day-to-day operations, including people and branding, but not
     the owner-exclusive actions (delete, transfer) and not billing. */
  admin: [
    "org.read",
    "org.update",
    "team.read",
    "team.invite",
    "team.updateRole",
    "team.revoke",
    "customer.read",
    "customer.create",
    "customer.update",
    "customer.delete",
    "receipt.read",
    "receipt.create",
    "receipt.void",
    "receipt.reissue",
    "invoice.read",
    "invoice.create",
    "invoice.update",
    "invoice.issue",
    "invoice.cancel",
    "invoice.recordPayment",
    "report.read",
  ],

  /* STAFF — does the work, but cannot change the organization or the team. */
  staff: [
    "org.read",
    "team.read",
    "customer.read",
    "customer.create",
    "customer.update",
    "receipt.read",
    "receipt.create",
    "receipt.void",
    "invoice.read",
    "invoice.create",
    "invoice.recordPayment",
    "report.read",
  ],

  /* VIEWER — reads only. `customer.delete` is deliberately absent: "read-only
     access to explicitly permitted resources" means no writes at all. */
  viewer: [
    "org.read",
    "team.read",
    "customer.read",
    "receipt.read",
    "invoice.read",
    "report.read",
  ],
};

/** Every permission, for the owner. */
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(GRANTS.admin),
  staff: new Set(GRANTS.staff),
  viewer: new Set(GRANTS.viewer),
};

/**
 * May this role hold this permission?
 *
 * The single question every guard asks. Unknown permissions return `false`
 * rather than throwing, so a typo in a new route fails closed instead of
 * accidentally passing.
 */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Every permission a role holds — used by the UI to hide controls. */
export function permissionsFor(role: Role | null | undefined): Permission[] {
  if (!role) return [];
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/**
 * Roles strictly below `actor` in the hierarchy.
 *
 * A role may only be assigned or revoked against someone it outranks. This is
 * what stops a `staff` member — or an `admin` — from minting themselves an
 * `owner`, or from demoting the owner, regardless of what the request body
 * claims. Enforced in the route, from the session, never from the client.
 */
const RANK: Record<Role, number> = { viewer: 0, staff: 1, admin: 2, owner: 3 };

export function outranks(actor: Role, target: Role): boolean {
  return RANK[actor] > RANK[target];
}

export function canAssignRole(actor: Role, target: Role): boolean {
  return outranks(actor, target);
}

/**
 * Exactly one owner is required per organization.
 *
 * Used by the route before it will demote or revoke an owner, so the
 * organization can never be left without somebody who can manage it.
 */
export function isOwner(role: Role): boolean {
  return role === "owner";
}