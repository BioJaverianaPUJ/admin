export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  INVALID_CREDENTIALS: "Correo o contraseña incorrectos.",
  USER_DEACTIVATED: "Esta cuenta está suspendida.",
  UNAUTHORIZED: "La sesión terminó. Inicia sesión de nuevo.",
  FORBIDDEN: "No tienes permiso para realizar esta operación.",
  SPECIES_ALREADY_EXISTS: "Ya existe una especie con ese nombre.",
  USERNAME_ALREADY_EXISTS: "Ese nombre de usuario ya está en uso.",
};
export type Upstream = <T>(
  path: string,
  token?: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
/** Claves que nunca se imprimen en los registros de depuración. */
const secret = /pass(word)?|token|secret|authorization|cookie/i;
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      secret.test(k) ? "[oculto]" : redact(v, depth + 1),
    ]),
  );
}
/**
 * Depuración: imprime en la terminal cada respuesta del backend. Activo por
 * defecto fuera de producción; DEBUG_BACKEND=0 lo apaga y DEBUG_BACKEND=1 lo
 * activa también en producción.
 */
const debugBackend =
  process.env.DEBUG_BACKEND === "1" ||
  (!["production", "test"].includes(process.env.NODE_ENV ?? "") &&
    process.env.DEBUG_BACKEND !== "0");
function logExchange(
  method: string,
  path: string,
  status: number | string,
  ms: number,
  request: unknown,
  response: unknown,
) {
  if (!debugBackend) return;
  const text = JSON.stringify(redact(response), null, 2) ?? "(sin cuerpo)";
  console.log(
    `\n[backend] ${method} ${path} → ${status} (${ms} ms)` +
      (request ? `\n  envío: ${JSON.stringify(redact(request))}` : "") +
      `\n  respuesta: ${text.length > 4000 ? text.slice(0, 4000) + "\n  … (recortado)" : text}`,
  );
}

export function createUpstream(base: string): Upstream {
  const url = new URL(base);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw Error("BACKEND_URL debe usar HTTPS.");
  return async <T>(
    path: string,
    token?: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    let response: Response;
    const started = Date.now();
    try {
      response = await fetch(base.replace(/\/$/, "") + path, {
        method,
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      logExchange(
        method,
        path,
        "sin conexión",
        Date.now() - started,
        body,
        String(e),
      );
      throw new HttpError(
        502,
        "No pudimos conectar con BioJaveriana. Intenta de nuevo.",
      );
    }
    const data = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    logExchange(
      method,
      path,
      response.status,
      Date.now() - started,
      body,
      data,
    );
    if (!response.ok)
      throw new HttpError(
        response.status,
        messages[String(data?.code)] ??
          {
            401:
              path === "/auth/login"
                ? "Correo o contraseña incorrectos."
                : "La sesión terminó.",
            429: "Demasiados intentos. Espera unos minutos antes de volver a intentar.",
            500: "El servidor de BioJaveriana tuvo un error interno (500). Intenta más tarde.",
            502: "El backend de BioJaveriana no está disponible (502). Intenta más tarde o avisa al equipo del backend.",
            503: "El servidor de BioJaveriana no está disponible temporalmente (503). Intenta más tarde.",
            504: "El servidor de BioJaveriana tardó demasiado en responder (504). Intenta de nuevo más tarde.",
            403: "No tienes permiso.",
            404: "No se encontró el registro.",
            409: "El cambio entra en conflicto con otro registro.",
            400: "El servidor rechazó los datos. Revisa los campos.",
          }[response.status] ??
          "No fue posible completar la operación.",
      );
    return data as T;
  };
}

/** Recorre todas las páginas de un listado paginado del backend. */
export async function collectPages<T>(
  upstream: Upstream,
  path: string,
  token: string,
  maxPages = 50,
): Promise<T[]> {
  const items: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 0, total = 1; page < total && page < maxPages; page++) {
    const data = await upstream<
      | T[]
      | {
          content?: T[];
          pagination?: { totalPages?: number };
          totalPages?: number;
        }
    >(`${path}${sep}page=${page}&size=100`, token);
    if (Array.isArray(data)) return data;
    items.push(...(data?.content ?? []));
    total = data?.pagination?.totalPages ?? data?.totalPages ?? 1;
  }
  return items;
}
