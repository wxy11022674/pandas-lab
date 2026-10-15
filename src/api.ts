export class ApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(
    "/api" + url,
    body instanceof FormData
      ? { method: "POST", body }
      : body !== undefined
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {},
  );
  if (!r.ok) {
    let code = "NETWORK_ERROR";
    try {
      const e = await r.json();
      code = e.detail?.code || "NETWORK_ERROR";
    } catch {}
    throw new ApiError(code);
  }
  return r.json();
}
