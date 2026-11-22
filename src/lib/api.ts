export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/**
 * Depuración: imprime en la consola del navegador (F12) cada respuesta del
 * servidor. Activo en desarrollo; en producción con
 * localStorage.setItem("bio-debug", "1").
 */
function debugEnabled() {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem("bio-debug") === "1";
  } catch {
    return false;
  }
}
function logResponse(
  method: string,
  path: string,
  status: number,
  ms: number,
  body: unknown,
) {
  if (!debugEnabled()) return;
  const style =
    status >= 400
      ? "color:#e5735f;font-weight:bold"
      : "color:#7cc47f;font-weight:bold";
  console.groupCollapsed(
    `%c[admin-api] ${method} ${path} → ${status} (${ms} ms)`,
    style,
  );
  console.log(body);
  console.groupEnd();
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  notifySession = true,
): Promise<T> {
  let response: Response;
  const method = (init.method ?? "GET").toUpperCase();
  const started = performance.now();
  try {
    response = await fetch(`/admin-api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(60000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(
      0,
      "No pudimos conectar. Revisa la conexión e intenta de nuevo.",
    );
  }
  const ms = Math.round(performance.now() - started);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    logResponse(method, path, response.status, ms, body);
    if (
      notifySession &&
      (response.status === 401 ||
        response.headers.get("X-Session-Ended") === "1")
    )
      window.dispatchEvent(new Event("session-ended"));
    throw new ApiError(
      response.status,
      body.message ?? "No fue posible completar la operación.",
    );
  }
  const data =
    response.status === 204 ? undefined : ((await response.json()) as T);
  logResponse(method, path, response.status, ms, data ?? "(sin contenido)");
  return data as T;
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "No fue posible completar la operación.";
}
