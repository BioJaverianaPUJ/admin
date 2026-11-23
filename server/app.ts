import { registerSocialRoutes } from "./social";
import { registerAchievementRoutes } from "./achievements";
import { registerGamificationRoutes } from "./gamification";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  loginSchema,
  speciesSchema,
  specimenUpdateSchema,
  userPatchSchema,
} from "../shared/validation";
import type { User, Page, Species, Specimen } from "../shared/types";
import { HttpError, collectPages, type Upstream } from "./upstream";

interface Session {
  token: string;
  expires: number;
  user: User;
  created: number;
  refresh?: Promise<void>;
}
export interface AppOptions {
  upstream: Upstream;
  origin: string;
  production?: boolean;
  localPort?: number;
}
export function createApp({
  upstream,
  origin,
  production = false,
  localPort = 4174,
}: AppOptions) {
  const app = express(),
    sessions = new Map<string, Session>();
  const allowedOrigins = new Set([origin]);
  if (!production) {
    const configured = new URL(origin);
    if (
      configured.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(configured.hostname)
    ) {
      for (const host of ["localhost", "127.0.0.1"]) {
        for (const port of [configured.port || "80", String(localPort)]) {
          allowedOrigins.add(
            `http://${host}${port === "80" ? "" : ":" + port}`,
          );
        }
      }
    }
  }
  const cookieName = production ? "__Host-bio-admin" : "bio-admin";
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            "https:",
            "https://tile.openstreetmap.org",
            "https://*.tile.openstreetmap.org",
          ],
          // La vista 3D (MapLibre) descarga las teselas con fetch y usa workers blob.
          connectSrc: [
            "'self'",
            "https://tile.openstreetmap.org",
            "https://basemaps.cartocdn.com",
            ...(production
              ? []
              : ["ws://localhost:5173", "ws://127.0.0.1:5173"]),
          ],
          workerSrc: ["'self'", "blob:"],
          childSrc: ["'self'", "blob:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production,
    }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.use("/admin-api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/admin-api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !allowedOrigins.has(req.headers.origin ?? "")
    )
      return res
        .status(403)
        .json({ message: "Origen de la solicitud no permitido." });
    next();
  });
  const sessionId = (req: Request) =>
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
  const clear = (req: Request, res: Response) => {
    const id = sessionId(req);
    if (id) sessions.delete(id);
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/",
    });
  };
  async function authenticate(req: Request, res: Response) {
    const id = sessionId(req),
      session = id ? sessions.get(id) : undefined;
    if (
      !session ||
      session.expires <= Date.now() ||
      Date.now() - session.created > 8 * 60 * 60 * 1000
    ) {
      clear(req, res);
      throw new HttpError(401, "Tu sesión terminó. Inicia sesión de nuevo.");
    }
    try {
      // Fetch the current role for every operation: never trust a stale JWT role.
      session.user = await upstream<User>("/users/me", session.token);
      if (!["ADMIN", "SUPERADMIN"].includes(session.user.role))
        throw new HttpError(
          403,
          "Esta cuenta no tiene acceso de administrador.",
        );
      if (session.expires - Date.now() < 120000) {
        session.refresh ??= (async () => {
          const r = await upstream<{ token: string; expiresIn: string }>(
            "/auth/refresh-token",
            session.token,
            "POST",
          );
          session.token = r.token;
          session.expires = Date.parse(r.expiresIn);
        })().finally(() => {
          session.refresh = undefined;
        });
        await session.refresh;
      }
      return session;
    } catch (e) {
      if (e instanceof HttpError && [401, 403].includes(e.status)) {
        clear(req, res);
        res.setHeader("X-Session-Ended", "1");
      }
      throw e;
    }
  }
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Demasiados intentos. Espera unos minutos." },
  });
  app.post("/admin-api/login", limit, async (req, res) => {
    const body = loginSchema.parse(req.body);
    const login = await upstream<{ token: string; expiresIn: string }>(
      "/auth/login",
      undefined,
      "POST",
      body,
    );
    const user = await upstream<User>("/users/me", login.token);
    if (!["ADMIN", "SUPERADMIN"].includes(user.role))
      throw new HttpError(403, "Tu cuenta no tiene el rol de administrador.");
    const expires = Date.parse(login.expiresIn);
    if (!Number.isFinite(expires) || expires <= Date.now())
      throw new HttpError(502, "El servidor entregó una sesión inválida.");
    for (const [id, s] of sessions)
      if (s.expires <= Date.now() || Date.now() - s.created > 28800000)
        sessions.delete(id);
    if (sessions.size >= 1000)
      throw new HttpError(503, "No es posible abrir más sesiones ahora.");
    clear(req, res);
    const id = randomBytes(32).toString("hex");
    sessions.set(id, {
      token: login.token,
      expires,
      user,
      created: Date.now(),
    });
    res
      .cookie(cookieName, id, {
        httpOnly: true,
        secure: production,
        sameSite: "strict",
        path: "/",
      })
      .json({ user });
  });
  app.post("/admin-api/logout", (req, res) => {
    clear(req, res);
    res.sendStatus(204);
  });
  app.get("/admin-api/session", async (req, res) => {
    const session = await authenticate(req, res);
    res.json({ user: session.user });
  });
  registerSocialRoutes(app, authenticate, upstream);
  registerAchievementRoutes(app, authenticate, upstream);
  registerGamificationRoutes(app, authenticate, upstream);
  app.get("/admin-api/capabilities", async (req, res) => {
    await authenticate(req, res);
    res.json({
      species: true,
      specimens: true,
      users: true,
      specimenLocationWrites: false,
      zones: false,
      gamification: false,
      reports: true,
      pois: true,
      posts: true,
      reviews: true,
      userState: false,
      adminRemoval: false,
    });
  });
  app.get("/admin-api/observations", async (req, res) => {
    const session = await authenticate(req, res);
    const query = z
      .object({
        page: z.coerce.number().int().min(0).default(0),
        size: z.coerce.number().int().min(1).max(100).default(12),
        revisionRequested: z.enum(["true", "false"]).default("true"),
      })
      .strict()
      .parse(req.query);
    const params = new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, String(v)]),
    );
    res.json(await upstream(`/observations/admin?${params}`, session.token));
  });
  async function all<T>(resource: string, token: string) {
    const items: T[] = [];
    let page = 0,
      total = 1;
    while (page < total) {
      if (page >= 200)
        throw new HttpError(
          422,
          "La búsqueda supera 20.000 registros. El backend necesita filtros para este volumen.",
        );
      const data = await upstream<Page<T>>(
        `/${resource}?page=${page++}&size=100`,
        token,
      );
      items.push(...data.content);
      total = data.pagination.totalPages;
    }
    return items;
  }
  // Todo lo que pinta el mapa general del campus en una sola respuesta.
  app.get("/admin-api/campus/overview", async (req, res) => {
    const session = await authenticate(req, res);
    const [specimens, species, pois, sightings] = await Promise.all([
      all<Specimen>("specimens", session.token),
      all<Species>("species", session.token),
      collectPages<unknown>(upstream, "/pois", session.token).catch(() => []),
      collectPages<{
        id: string;
        latitude: number | null;
        longitude: number | null;
        checked: boolean;
        observationType: string | null;
        speciesCommonName: string | null;
        imageUrl: string | null;
        createdAt: string;
      }>(upstream, "/observations/admin", session.token, 10).catch(() => []),
    ]);
    res.json({
      specimens,
      species,
      pois,
      // Solo observaciones de fauna u hongos identificadas y con ubicación.
      sightings: sightings.filter(
        (o) =>
          o.checked &&
          o.latitude != null &&
          o.longitude != null &&
          (o.observationType === "ANIMAL" || o.observationType === "FUNGI"),
      ),
    });
  });
  app.get("/admin-api/resources/:resource", async (req, res) => {
    const session = await authenticate(req, res),
      resource = z
        .enum(["species", "specimens", "users"])
        .parse(req.params.resource);
    const q = z
      .object({
        page: z.coerce.number().int().min(0).default(0),
        size: z.coerce.number().int().min(1).max(100).default(12),
        q: z.string().max(180).default(""),
        family: z.string().max(120).default(""),
        speciesId: z.string().default(""),
        role: z.enum(["", "USER", "ADMIN", "SUPERADMIN"]).default(""),
        state: z.enum(["", "ACTIVE", "SUSPENDED"]).default(""),
        health: z
          .enum(["", "WELL", "FAIR", "POOR", "DEAD", "UNKNOWN"])
          .default(""),
      })
      .parse(req.query);
    // RF-55: estado de cada cuenta a partir de sus suspensiones activas, y
    // sin el género, que el administrador no necesita consultar.
    const withState = async (list: unknown[]) => {
      if (resource !== "users") return list;
      let bans: {
        id: string;
        userId: string;
        status: string;
        banType: string;
        reason: string;
        expiresAt: string | null;
        createdAt: string;
      }[];
      try {
        bans = await all("bans", session.token);
      } catch {
        // Sin suspensiones disponibles se listan las cuentas sin estado.
        return (list as User[]).map(({ gender: _gender, ...u }) => u);
      }
      const now = Date.now();
      const active = new Map<string, typeof bans>();
      for (const b of bans)
        if (
          b.status === "ACTIVE" &&
          (!b.expiresAt || Date.parse(b.expiresAt) > now)
        )
          active.set(b.userId, [...(active.get(b.userId) ?? []), b]);
      return (list as User[]).map(({ gender: _gender, ...u }) => {
        const own = active.get(u.id) ?? [];
        // La suspensión vigente más larga es la que define el estado.
        const ban = [...own].sort((a, b) =>
          !a.expiresAt
            ? -1
            : !b.expiresAt
              ? 1
              : b.expiresAt.localeCompare(a.expiresAt),
        )[0];
        return {
          ...u,
          status: ban ? "SUSPENDED" : "ACTIVE",
          ...(ban
            ? {
                ban: {
                  id: ban.id,
                  ids: own.map((b) => b.id),
                  reason: ban.reason,
                  banType: ban.banType,
                  expiresAt: ban.expiresAt,
                  createdAt: ban.createdAt,
                },
              }
            : {}),
        };
      });
    };
    if (!q.q && !q.family && !q.speciesId && !q.role && !q.state && !q.health) {
      const page = await upstream<Page<unknown>>(
        `/${resource}?page=${q.page}&size=${q.size}`,
        session.token,
      );
      return res.json({ ...page, content: await withState(page.content) });
    }
    const rows = await all<Species | Specimen | User>(resource, session.token);
    const species =
      resource === "specimens"
        ? await all<Species>("species", session.token)
        : [];
    const filtered = rows.filter((row) => {
      const r = row as unknown as Record<string, unknown>;
      const s = species.find((s) => s.id === r.speciesId);
      const text = [
        r.scientificName,
        r.commonName,
        r.family,
        r.username,
        r.firstName,
        r.lastName,
        r.email,
        s?.commonName,
        s?.scientificName,
      ]
        .join(" ")
        .toLocaleLowerCase("es");
      return (
        text.includes(q.q.toLocaleLowerCase("es")) &&
        (!q.family || (s?.family ?? r.family) === q.family) &&
        (!q.speciesId || r.speciesId === q.speciesId) &&
        (!q.role || r.role === q.role) &&
        (!q.health || (r.healthStatus ?? "UNKNOWN") === q.health)
      );
    });
    const stated = (await withState(filtered)).filter(
      (row) => !q.state || (row as { status?: string }).status === q.state,
    );
    const totalPages = Math.ceil(stated.length / q.size);
    res.json({
      content: stated.slice(q.page * q.size, (q.page + 1) * q.size),
      pagination: {
        page: q.page,
        size: q.size,
        totalElements: stated.length,
        totalPages,
        first: q.page === 0,
        last: q.page >= totalPages - 1,
      },
    });
  });
  // Resumen del catálogo: ejemplares por especie y su estado de salud.
  app.get("/admin-api/catalog/stats", async (req, res) => {
    const s = await authenticate(req, res);
    const specimens = await all<Specimen>("specimens", s.token);
    const bySpecies: Record<
      string,
      { total: number; health: Record<string, number> }
    > = {};
    const health: Record<string, number> = {};
    for (const sp of specimens) {
      const entry = (bySpecies[sp.speciesId] ??= { total: 0, health: {} });
      const h = sp.healthStatus ?? "UNKNOWN";
      entry.total++;
      entry.health[h] = (entry.health[h] ?? 0) + 1;
      health[h] = (health[h] ?? 0) + 1;
    }
    res.json({ totalSpecimens: specimens.length, health, bySpecies });
  });
  app.get("/admin-api/options/species", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(await all<Species>("species", s.token));
  });
  app.get("/admin-api/resources/:resource/:id", async (req, res) => {
    const s = await authenticate(req, res);
    const resource = z
      .enum(["species", "specimens", "users"])
      .parse(req.params.resource);
    const id = z.uuid().parse(req.params.id);
    res.json(await upstream(`/${resource}/${id}`, s.token));
  });
  app.post("/admin-api/resources/species", async (req, res) => {
    const s = await authenticate(req, res);
    res
      .status(201)
      .json(
        await upstream(
          "/species",
          s.token,
          "POST",
          speciesSchema.parse(req.body),
        ),
      );
  });
  app.patch("/admin-api/resources/species/:id", async (req, res) => {
    const s = await authenticate(req, res);
    const id = z.uuid().parse(req.params.id);
    res.json(
      await upstream(
        `/species/${id}`,
        s.token,
        "PATCH",
        speciesSchema.parse(req.body),
      ),
    );
  });
  app.delete("/admin-api/resources/species/:id", async (req, res) => {
    const s = await authenticate(req, res),
      id = z.uuid().parse(req.params.id);
    const specimens = await all<Specimen>("specimens", s.token);
    if (specimens.some((v) => v.speciesId === id))
      throw new HttpError(
        409,
        "La especie tiene especímenes asociados. La eliminación en cascada aún no está garantizada por el backend.",
      );
    await upstream(`/species/${id}`, s.token, "DELETE");
    res.sendStatus(204);
  });
  app.post("/admin-api/resources/specimens", async (req, res) => {
    await authenticate(req, res);
    throw new HttpError(
      409,
      "El registro requiere el límite oficial del campus y detección atómica de duplicados en el backend.",
    );
  });
  app.patch("/admin-api/resources/specimens/:id", async (req, res) => {
    const s = await authenticate(req, res),
      id = z.uuid().parse(req.params.id),
      body = specimenUpdateSchema.parse(req.body),
      current = await upstream<Specimen>(`/specimens/${id}`, s.token);
    if (
      body.latitude !== current.latitude ||
      body.longitude !== current.longitude
    )
      throw new HttpError(
        409,
        "No es posible cambiar la ubicación hasta disponer del límite oficial del campus.",
      );
    res.json(await upstream(`/specimens/${id}`, s.token, "PATCH", body));
  });
  app.delete("/admin-api/resources/specimens/:id", async (req, res) => {
    const s = await authenticate(req, res),
      id = z.uuid().parse(req.params.id);
    await upstream(`/specimens/${id}`, s.token, "DELETE");
    res.sendStatus(204);
  });
  app.patch("/admin-api/resources/users/:id", async (req, res) => {
    const s = await authenticate(req, res),
      id = z.uuid().parse(req.params.id),
      body = userPatchSchema.parse(req.body),
      target = await upstream<User>(`/users/${id}`, s.token);
    if (
      (target.role === "SUPERADMIN" || target.username === "superadmin") &&
      body.role !== undefined
    )
      throw new HttpError(409, "El administrador inicial conserva su rol.");
    if (id === s.user.id && body.role === "USER")
      throw new HttpError(
        409,
        "No puedes suspender tu propia sesión administrativa.",
      );
    res.json(await upstream(`/users/${id}`, s.token, "PATCH", body));
  });
  app.delete("/admin-api/resources/users/:id", async (req, res) => {
    const s = await authenticate(req, res),
      id = z.uuid().parse(req.params.id),
      target = await upstream<User>(`/users/${id}`, s.token);
    if (
      target.role === "SUPERADMIN" ||
      target.username === "superadmin" ||
      target.id === s.user.id
    )
      throw new HttpError(
        409,
        "No puedes eliminar la cuenta inicial ni tu propia sesión administrativa.",
      );
    await upstream(`/users/${id}`, s.token, "DELETE");
    res.sendStatus(204);
  });
  app.use("/admin-api", (_req, res) =>
    res.status(404).json({ message: "Esta operación no está disponible." }),
  );
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      // Las validaciones propias (p. ej. de la condición) traen su mensaje.
      const custom = err.issues.find((i) => i.code === "custom")?.message;
      return res.status(400).json({
        message: custom ?? "Revisa los campos obligatorios y sus valores.",
      });
    }
    if (err instanceof HttpError)
      return res.status(err.status).json({ message: err.message });
    res
      .status(500)
      .json({ message: "Ocurrió un error. No se confirmó la operación." });
  });
  return app;
}
