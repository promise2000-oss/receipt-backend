/**
 * Minimal fetch wrapper for the API.
 *
 * The browser talks to Next.js only; Next proxies `/api/*` to Express, so
 * cookies stay same-origin and CORS never enters the picture.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string>;

  constructor(
    message: string,
    status: number,
    code = "ERROR",
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Message for a specific form field, falling back to the general one. */
  field(name: string): string | undefined {
    return this.details?.[name];
  }
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

/**
 * FormData cannot ride on a GET: `fetch` rejects it with
 * "Request with GET/HEAD method cannot have body" *before* sending anything, so
 * the call fails with no request on the wire and no status code to inspect —
 * the logo upload did exactly that, surfacing only as a generic client-side
 * error. Requiring the method on the formData branch makes that a compile
 * error instead.
 */
type RequestOptions = { body?: unknown; signal?: AbortSignal } & (
  | { formData: FormData; method: Exclude<HttpMethod, "GET"> }
  | { formData?: undefined; method?: HttpMethod }
);

async function parseError(response: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* non-JSON error body */
  }

  const data = payload as
    | { message?: string; code?: string; details?: Record<string, string> }
    | null;

  return new ApiError(
    data?.message ?? `Request failed (${response.status})`,
    response.status,
    data?.code ?? "ERROR",
    data?.details,
  );
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "include",
    signal: options.signal,
    headers: options.formData ? {} : { "Content-Type": "application/json" },
  };

  if (options.formData) {
    init.body = options.formData;
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, init);
  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Fetch a plain-text (or HTML) response — used by the live preview. */
export async function apiText(path: string, options: RequestOptions = {}): Promise<string> {
  const init: RequestInit = {
    method: options.method ?? "POST",
    credentials: "include",
    signal: options.signal,
    headers: options.formData ? {} : { "Content-Type": "application/json" },
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  };

  const response = await fetch(path, init);
  if (!response.ok) throw await parseError(response);
  return response.text();
}

/** Fetch a binary resource (PDF) as a Blob. */
async function apiBlob(path: string): Promise<Blob> {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) throw await parseError(response);
  return response.blob();
}

/** Trigger a browser download for an API path. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
