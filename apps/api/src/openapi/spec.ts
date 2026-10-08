/**
 * The OpenAPI 3.1 document for the API.
 *
 * Paths are written against the server URL (`/api`), so `/receipts` below is
 * served at `/api/receipts`. Authentication is a session cookie, therefore the
 * "Try it out" flow works without an Authorize step when this page is opened
 * through the same origin the app uses.
 */
import { SESSION_COOKIE } from "../lib/auth";
import { ref, requestSchemas, responseSchemas, type Json } from "./schemas";

const json = (schema: Json): Json => ({ "application/json": { schema } });

const ok = (description: string, schema: Json): Json => ({
  description,
  content: json(schema),
});

const error = (description: string): Json => ({
  description,
  content: json(ref("ApiError")),
});

const html = (description: string): Json => ({
  description,
  content: { "text/html": { schema: { type: "string" } } },
});

const pdf = (description: string): Json => ({
  description,
  content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
});

/** A file whose media type is whatever was stored (PDF, PNG, SVG, …). */
const binary = (description: string): Json => ({
  description,
  content: {
    "application/octet-stream": { schema: { type: "string", format: "binary" } },
  },
});

/** A `[status, response]` pair, the shape `Object.fromEntries` consumes. */
type Resp = [number, Json];

function op(input: {
  tag: string;
  summary: string;
  operationId: string;
  description?: string;
  public?: boolean;
  parameters?: Json[];
  requestBody?: Json;
  responses: Resp[];
}): Json {
  const { tag, public: isPublic, description, ...rest } = input;
  return {
    tags: [tag],
    ...(description ? { description } : {}),
    // Global security requires the cookie; public endpoints opt out.
    ...(isPublic ? { security: [] } : {}),
    ...rest,
    responses: Object.fromEntries(rest.responses),
  };
}

const pathId = (what: string): Json => ({
  name: "id",
  in: "path",
  required: true,
  description: `${what} id.`,
  schema: { type: "string" },
});

const body = (schemaName: string, description?: string): Json => ({
  required: true,
  description,
  content: json(ref(schemaName)),
});

const jsonBody = (schema: Json, description?: string, required = true): Json => ({
  required,
  description,
  content: json(schema),
});

const q = (
  name: string,
  description: string,
  schema: Json = { type: "string" },
): Json => ({ name, in: "query", description, schema });

export const openApiSpec: Json = {
  openapi: "3.1.0",
  info: {
    title: "Eleosstyles Receipt System API",
    version: "1.0.0",
    summary: "Create, brand, send and track sales receipts.",
    description: [
      "API behind the Eleosstyles receipt tool: businesses, customers, receipts,",
      "branded PDFs and expiring share links.",
      "",
      "**Authentication.** Everything except `auth/signup`, `auth/login`,",
      "`auth/logout`, `health`, `files/{token}` and the `public/*` share endpoints",
      "requires the session cookie set by `POST /auth/login` (an httpOnly,",
      `SameSite=Lax cookie named \`${SESSION_COOKIE}\`). Open this page through the`,
      "app origin (`/api/docs`) and the browser sends it automatically — no",
      "Authorize step needed. Calling the API directly on another origin requires",
      "the cookie to be set by that origin.",
      "",
      "**Business rules that shape every response:**",
      "",
      "1. Issued receipts are immutable — correct them with **void + reissue**",
      "   (`409 RECEIPT_IMMUTABLE` if you try to edit money fields).",
      "2. Every read and write is scoped to the session's business; another",
      "   tenant's records simply resolve to `404`.",
      "3. Receipt numbers are unique and sequential per business.",
      "4. Totals are always recomputed server-side — client numbers are a preview.",
      "5. Errors are always `{ message, code, details? }` with an HTTP status.",
    ].join("\n"),
  },
  servers: [
    { url: "/api", description: "This origin" },
    { url: "http://localhost:4000/api", description: "Direct API, local development" },
  ],
  tags: [
    { name: "Health", description: "Liveness probe." },
    { name: "Auth", description: "Sign-up, sign-in and the current session." },
    { name: "Business", description: "Business settings, branding and logo." },
    { name: "Customers", description: "Customer CRUD, scoped to your business." },
    {
      name: "Receipts",
      description:
        "The receipt lifecycle: create, preview, PDF, share, void and reissue.",
    },
    { name: "Dashboard", description: "Today / week / month summary figures." },
    { name: "Files", description: "Private storage served through signed tokens." },
    {
      name: "Public share",
      description: "No-login endpoints addressed by an expiring capability token.",
    },
  ],
  security: [{ cookieAuth: [] }],
  paths: {
    // -------------------------------------------------------------- Health
    "/health": {
      get: op({
        tag: "Health",
        operationId: "health",
        summary: "Liveness probe",
        public: true,
        responses: [[200, ok("Service is up.", ref("Health"))]],
      }),
    },

    // ----------------------------------------------------------------- Auth
    "/auth/signup": {
      post: op({
        tag: "Auth",
        operationId: "signup",
        summary: "Create a business and its owner",
        description:
          "Creates the business and its owner user in one transaction and signs " +
          "the session cookie. `business` holds the brand defaults (currency, " +
          "receipt number prefix) that every later receipt inherits.",
        public: true,
        requestBody: body("SignupInput"),
        responses: [
          [
            201,
            {
              description: "Created and signed in (`Set-Cookie`).",
              content: json(ref("Auth")),
              headers: {
                "Set-Cookie": {
                  description: `httpOnly session cookie \`${SESSION_COOKIE}\`.`,
                  schema: { type: "string" },
                },
              },
            },
          ],
          [409, error("An account with that email already exists (EMAIL_TAKEN).")],
          [422, error("Validation failed; `details` maps a field path to its message.")],
          [429, error("Too many attempts. Try again in a few minutes.")],
        ],
      }),
    },

    "/auth/login": {
      post: op({
        tag: "Auth",
        operationId: "login",
        summary: "Sign in",
        description:
          "Sets the session cookie. Unknown email and wrong password return the " +
          "same message, so the endpoint never reveals which accounts exist.",
        public: true,
        requestBody: body("LoginInput"),
        responses: [
          [200, ok("Signed in (`Set-Cookie`).", ref("Auth"))],
          [401, error("Incorrect email or password (INVALID_CREDENTIALS).")],
          [422, error("Validation failed.")],
          [429, error("Too many attempts. Try again in a few minutes.")],
        ],
      }),
    },

    "/auth/logout": {
      post: op({
        tag: "Auth",
        operationId: "logout",
        summary: "Sign out",
        description: "Clears the session cookie. Safe to call without a session.",
        public: true,
        responses: [[200, ok("Cookie cleared.", ref("Ok"))]],
      }),
    },

    "/auth/me": {
      get: op({
        tag: "Auth",
        operationId: "me",
        summary: "Current user and business",
        responses: [
          [200, ok("Session payload.", ref("Auth"))],
          [401, error("Missing, expired or tampered session cookie.")],
        ],
      }),
    },

    // ------------------------------------------------------------ Business
    "/business": {
      get: op({
        tag: "Business",
        operationId: "getBusiness",
        summary: "Read business settings",
        responses: [
          [200, ok("Business settings.", ref("Business"))],
          [401, error("Authentication required.")],
          [404, error("Business not found for this session.")],
        ],
      }),
      patch: op({
        tag: "Business",
        operationId: "updateBusiness",
        summary: "Update business settings",
        description:
          "Name, contact details, currency, brand colours and receipt number " +
          "prefix. Unspecified fields are left untouched.",
        requestBody: body("BusinessUpdateInput"),
        responses: [
          [200, ok("Updated business settings.", ref("Business"))],
          [401, error("Authentication required.")],
          [422, error("Validation failed.")],
        ],
      }),
    },

    "/business/logo": {
      post: op({
        tag: "Business",
        operationId: "uploadLogo",
        summary: "Upload the business logo",
        description:
          "Multipart upload, max 3 MB, one of PNG/JPEG/WebP/SVG/GIF. The " +
          "previous logo is removed from storage, and `logo_url` comes back as a " +
          "signed, expiring URL.",
        requestBody: jsonBody(
          {
            type: "object",
            properties: { logo: { type: "string", format: "binary" } },
            required: ["logo"],
          },
          "The logo file, under the field name `logo`.",
        ),
        responses: [
          [200, ok("Business with the new logo URL.", ref("Business"))],
          [401, error("Authentication required.")],
          [422, error("Missing file, wrong type or larger than 3 MB.")],
        ],
      }),
      delete: op({
        tag: "Business",
        operationId: "deleteLogo",
        summary: "Remove the business logo",
        responses: [
          [200, ok("Business with `logo_url` cleared.", ref("Business"))],
          [401, error("Authentication required.")],
          [404, error("Business not found.")],
        ],
      }),
    },

    // ----------------------------------------------------------- Customers
    "/customers": {
      get: op({
        tag: "Customers",
        operationId: "listCustomers",
        summary: "List or search customers",
        description: "Case-insensitive match on name, phone or email; newest first.",
        parameters: [q("search", "Substring to match against name, phone or email.")],
        responses: [
          [200, ok("Matching customers.", ref("CustomerList"))],
          [401, error("Authentication required.")],
        ],
      }),
      post: op({
        tag: "Customers",
        operationId: "createCustomer",
        summary: "Create a customer",
        requestBody: body("CustomerInput", "Empty `phone`/`email` mean “none”."),
        responses: [
          [201, ok("Created customer.", ref("Customer"))],
          [401, error("Authentication required.")],
          [422, error("Validation failed.")],
        ],
      }),
    },

    "/customers/{id}": {
      get: op({
        tag: "Customers",
        operationId: "getCustomer",
        summary: "Read one customer",
        description: "Includes `receipt_count`. Another tenant's id returns 404.",
        parameters: [pathId("Customer")],
        responses: [
          [200, ok("Customer with their receipt count.", ref("Customer"))],
          [401, error("Authentication required.")],
          [404, error("No such customer in this business.")],
        ],
      }),
      patch: op({
        tag: "Customers",
        operationId: "updateCustomer",
        summary: "Update a customer",
        parameters: [pathId("Customer")],
        requestBody: body("CustomerInput"),
        responses: [
          [200, ok("Updated customer.", ref("Customer"))],
          [401, error("Authentication required.")],
          [404, error("No such customer in this business.")],
          [422, error("Validation failed.")],
        ],
      }),
      delete: op({
        tag: "Customers",
        operationId: "deleteCustomer",
        summary: "Delete a customer",
        description:
          "Issued receipts are kept: the foreign key is `ON DELETE SET NULL`, so " +
          "removing a customer never removes receipts.",
        parameters: [pathId("Customer")],
        responses: [
          [200, ok("Deleted.", ref("Ok"))],
          [401, error("Authentication required.")],
          [404, error("No such customer in this business.")],
        ],
      }),
    },

    // ------------------------------------------------------------ Receipts
    "/receipts": {
      get: op({
        tag: "Receipts",
        operationId: "listReceipts",
        summary: "List receipts with filters",
        parameters: [
          q("search", "Matches receipt number, customer name or item description."),
          q("status", "Voided receipts only, or everything.", {
            type: "string",
            enum: ["all", "active", "void"],
            default: "all",
          }),
          q("payment_status", "Filter by payment state.", {
            type: "string",
            enum: ["all", "paid", "partial", "pending"],
            default: "all",
          }),
          q("from", "Earliest issue date, `YYYY-MM-DD` (inclusive)."),
          q("to", "Latest issue date, `YYYY-MM-DD` (inclusive)."),
          q("min", "Minimum total amount.", { type: "number" }),
          q("max", "Maximum total amount.", { type: "number" }),
          q("page", "Page number, 1-based.", {
            type: "integer",
            minimum: 1,
            default: 1,
          }),
          q("limit", "Page size (1–100).", {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 25,
          }),
        ],
        responses: [
          [200, ok("A page of receipts.", ref("ReceiptList"))],
          [401, error("Authentication required.")],
        ],
      }),
      post: op({
        tag: "Receipts",
        operationId: "createReceipt",
        summary: "Issue a receipt",
        description:
          "The only way a receipt comes into existence. `subtotal`, `tax`, " +
          "`total` and `paid_amount` are recomputed server-side from the line " +
          "items, and the next sequential number is allocated in the same " +
          "transaction as the insert.",
        requestBody: body(
          "ReceiptCreateInput",
          "`items` needs at least one line (max 200). Totals you send are ignored.",
        ),
        responses: [
          [201, ok("The issued receipt.", ref("Receipt"))],
          [401, error("Authentication required.")],
          [404, error("`customer_id` belongs to another business.")],
          [422, error("Validation failed (empty lines, bad dates, …).")],
        ],
      }),
    },

    "/receipts/preview": {
      post: op({
        tag: "Receipts",
        operationId: "previewReceipt",
        summary: "Render a draft receipt",
        description:
          "Renders the document without saving anything — the builder shows this " +
          "HTML in an iframe, so the preview is literally the same template the " +
          "PDF is produced from. The receipt number shown is the next one that " +
          "*would* be assigned; it is never consumed.",
        requestBody: body("ReceiptCreateInput"),
        responses: [
          [200, html("The receipt document.")],
          [401, error("Authentication required.")],
          [404, error("`customer_id` belongs to another business.")],
          [422, error("Validation failed.")],
        ],
      }),
    },

    "/receipts/{id}": {
      get: op({
        tag: "Receipts",
        operationId: "getReceipt",
        summary: "Read one receipt",
        description: "Includes line items and customer. Another tenant's id returns 404.",
        parameters: [pathId("Receipt")],
        responses: [
          [200, ok("The receipt.", ref("Receipt"))],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
        ],
      }),
    },

    "/receipts/{id}/document": {
      get: op({
        tag: "Receipts",
        operationId: "getReceiptDocument",
        summary: "Receipt HTML",
        description: "The exact HTML the PDF is built from, for the preview iframe.",
        parameters: [pathId("Receipt")],
        responses: [
          [200, html("The receipt document.")],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
        ],
      }),
    },

    "/receipts/{id}/pdf": {
      get: op({
        tag: "Receipts",
        operationId: "downloadReceiptPdf",
        summary: "Download the branded PDF",
        description:
          "Generates the PDF on first request and reuses it afterwards. Branded " +
          "with the business logo, palette and number prefix.",
        parameters: [pathId("Receipt")],
        responses: [
          [200, pdf("The receipt as a PDF, served as a download.")],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
        ],
      }),
    },

    "/receipts/{id}/generate-pdf": {
      post: op({
        tag: "Receipts",
        operationId: "generateReceiptPdf",
        summary: "Ensure the PDF exists",
        description:
          "Renders and stores the PDF if needed, then returns the receipt with a " +
          "freshly signed `pdf_url`.",
        parameters: [pathId("Receipt")],
        responses: [
          [200, ok("Receipt with `pdf_url` set.", ref("Receipt"))],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
        ],
      }),
    },

    "/receipts/{id}/void": {
      post: op({
        tag: "Receipts",
        operationId: "voidReceipt",
        summary: "Void a receipt",
        description:
          "Marks the receipt void (it is retained, never deleted) and stops it " +
          "counting towards dashboard revenue.",
        parameters: [pathId("Receipt")],
        requestBody: jsonBody(
          ref("VoidReceiptInput"),
          "Optional — send `{}` or omit the body entirely.",
          false,
        ),
        responses: [
          [200, ok("The voided receipt.", ref("Receipt"))],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
          [409, error("Already voided (ALREADY_VOID).")],
        ],
      }),
    },

    "/receipts/{id}/reissue": {
      post: op({
        tag: "Receipts",
        operationId: "reissueReceipt",
        summary: "Void and reissue",
        description:
          "The only legal correction. The original is voided (unless already " +
          "void) and a replacement is issued with a fresh number, linked back " +
          "through `original_receipt_id`.",
        parameters: [pathId("Receipt")],
        requestBody: jsonBody(
          ref("ReissueReceiptInput"),
          "Optional — send `{}` or omit the body entirely.",
          false,
        ),
        responses: [
          [201, ok("The replacement receipt.", ref("Receipt"))],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
        ],
      }),
    },

    "/receipts/{id}/share": {
      get: op({
        tag: "Receipts",
        operationId: "getReceiptShareLink",
        summary: "Create a share link",
        description: "Convenience variant that takes the lifetime as a query parameter.",
        parameters: [
          pathId("Receipt"),
          q("ttl", "Lifetime in seconds (1 hour – 1 year).", {
            type: "integer",
            minimum: 3600,
            maximum: 31536000,
          }),
        ],
        responses: [
          [200, ok("Signed, expiring share link.", ref("Share"))],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
        ],
      }),
      post: op({
        tag: "Receipts",
        operationId: "shareReceipt",
        summary: "Create a share link",
        description:
          "Returns `base64url(receiptId.expiresAt).HMAC` — no guessable id, " +
          "unforgeable without the server secret, dead after the TTL.",
        parameters: [pathId("Receipt")],
        requestBody: jsonBody(
          ref("ShareReceiptInput"),
          "Optional. Defaults to `SHARE_TTL_SECONDS` (7 days).",
          false,
        ),
        responses: [
          [200, ok("Signed, expiring share link.", ref("Share"))],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
          [422, error("TTL outside the allowed range.")],
        ],
      }),
    },

    "/receipts/{id}/email": {
      post: op({
        tag: "Receipts",
        operationId: "emailReceipt",
        summary: "Email the receipt",
        description:
          "Sends the receipt with the branded PDF attached and a view link that " +
          "expires with the share token.",
        parameters: [pathId("Receipt")],
        requestBody: body("EmailReceiptInput"),
        responses: [
          [200, ok("Send result.", ref("EmailResult"))],
          [401, error("Authentication required.")],
          [404, error("No such receipt in this business.")],
          [422, error("Validation failed (bad recipient address).")],
        ],
      }),
    },

    // ------------------------------------------------------------ Dashboard
    "/dashboard/summary": {
      get: op({
        tag: "Dashboard",
        operationId: "dashboardSummary",
        summary: "Today / week / month figures",
        description:
          "Three summary cards, the outstanding balance (receipts neither paid " +
          "nor void) and the eight most recent receipts. Voided receipts never " +
          "count towards revenue.",
        responses: [
          [200, ok("Dashboard summary.", ref("DashboardSummary"))],
          [401, error("Authentication required.")],
        ],
      }),
    },

    // --------------------------------------------------------------- Files
    "/files/{token}": {
      get: op({
        tag: "Files",
        operationId: "getFile",
        summary: "Fetch a private file",
        description:
          "Storage keys never leave the server: only a signed, expiring token " +
          "resolves to a file. Rate limited to 240 requests/minute.",
        public: true,
        parameters: [
          {
            name: "token",
            in: "path",
            required: true,
            description: "HMAC-signed file token issued with the file URL.",
            schema: { type: "string" },
          },
        ],
        responses: [
          [200, binary("The file — a PDF, or an image such as the business logo.")],
          [403, error("Token invalid or expired (LINK_INVALID).")],
          [404, error("File not found.")],
          [429, error("Too many file requests. Slow down.")],
        ],
      }),
    },

    // -------------------------------------------------------- Public share
    "/public/r/{token}": {
      get: op({
        tag: "Public share",
        operationId: "getPublicReceipt",
        summary: "Public receipt payload",
        description:
          "The receipt behind a share link, as JSON. Tenancy metadata is stripped: " +
          "no `business_id`, no internal ids beyond the receipt's own. The link " +
          "given to customers resolves to `/document` instead, which returns the " +
          "same receipt as a standalone printable page.",
        public: true,
        parameters: [tokenParam()],
        responses: [
          [200, ok("The shared receipt.", ref("PublicReceiptPage"))],
          [403, error("Link expired (LINK_EXPIRED) or invalid (LINK_INVALID).")],
          [404, error("Receipt no longer exists.")],
        ],
      }),
    },

    "/public/r/{token}/document": {
      get: op({
        tag: "Public share",
        operationId: "getPublicReceiptDocument",
        summary: "Public receipt HTML",
        description: "The same document the PDF is made from, for the preview iframe.",
        public: true,
        parameters: [tokenParam()],
        responses: [
          [200, html("The receipt document.")],
          [403, error("Link expired or invalid.")],
          [404, error("Receipt no longer exists.")],
        ],
      }),
    },

    "/public/r/{token}/download": {
      get: op({
        tag: "Public share",
        operationId: "downloadPublicReceipt",
        summary: "Public PDF download",
        description: "Anonymous download through the capability link; renders on demand.",
        public: true,
        parameters: [tokenParam()],
        responses: [
          [200, pdf("The receipt as a PDF.")],
          [403, error("Link expired or invalid.")],
          [404, error("Receipt no longer exists.")],
        ],
      }),
    },

    "/public/r/{token}/regenerate": {
      post: op({
        tag: "Public share",
        operationId: "regeneratePublicReceipt",
        summary: "Regenerate the PDF (owner only)",
        description:
          "Share link context, but the session must belong to the business that " +
          "issued it — a valid token alone is not enough.",
        parameters: [tokenParam()],
        responses: [
          [200, pdf("The freshly generated PDF.")],
          [401, error("Missing, expired or tampered session cookie.")],
          [403, error("Link expired or invalid.")],
          [404, error("Receipt does not belong to this business.")],
        ],
      }),
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: SESSION_COOKIE,
        description:
          "httpOnly session cookie returned by `POST /auth/signup` or " +
          "`POST /auth/login`. Send it automatically by opening these docs " +
          "from the app origin.",
      },
    },
    schemas: { ...requestSchemas, ...responseSchemas },
  },
};

/** The share-token path parameter, declared once and reused. */
function tokenParam(): Json {
  return {
    name: "token",
    in: "path",
    required: true,
    description: "Expiring share token from `POST /receipts/{id}/share`.",
    schema: { type: "string" },
  };
}
