const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api"
).replace(/\/+$/, "");

function buildApiUrl(path: string): string {
  // API_BASE_URL is the Django API prefix, e.g. http://127.0.0.1:8000/api.
  // Keep project paths relative to that prefix.
  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

async function readError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const data: unknown = await response.json();
      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        if (obj.detail != null) return String(obj.detail);
        if (obj.error != null) return String(obj.error);
        if (obj.message != null) return String(obj.message);
        return JSON.stringify(obj);
      }
      return String(data);
    }
    const text = await response.text();
    if (text.trim()) return text.trim().slice(0, 1000);
  } catch {
    // Use the status message below if the body cannot be read.
  }
  return `Request failed (${response.status} ${response.statusText || ""})`.trim();
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined && options.body !== null;

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) headers.set("Authorization", `Token ${token}`);
  }

  let response: Response;
  const url = buildApiUrl(path);

  try {
    response = await fetch(url, { ...options, headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Network error contacting Django API at ${url}. Check that Django is running, NEXT_PUBLIC_API_URL is correct, and CORS allows the frontend origin. (${detail})`
    );
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  if (response.status === 204) return undefined as T;

  if (response.status === 205) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    if (!body.trim()) return undefined as T;
    throw new Error(
      `Expected JSON from ${url}, but received ${contentType || "an unknown content type"}.`
    );
  }

  return (await response.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE" });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}
