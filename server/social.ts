import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { User } from "../shared/types";
import { HttpError, type Upstream } from "./upstream";
import { poiSchema } from "../shared/poi";
export function registerSocialRoutes(
  app: Express,
  authenticate: (
    req: Request,
    res: Response,
  ) => Promise<{ token: string; user: User }>,
  upstream: Upstream,
) {
  const uuid = (v: unknown) => z.uuid().parse(v);
  const pagination = (q: unknown) => {
    const p = z
      .object({
        page: z.coerce.number().int().min(0).default(0),
        size: z.coerce.number().int().min(1).max(100).default(12),
      })
      .parse(q);
    return `page=${p.page}&size=${p.size}`;
  };
  app.get("/admin-api/social/:resource", async (req, res) => {
    const s = await authenticate(req, res);
    const resource = z
      .enum(["posts", "reports", "pois", "bans"])
      .parse(req.params.resource);
    const routes = {
      posts: "/posts/admin",
      reports:
        req.query.pending === "true"
          ? "/reports/admin/pending"
          : "/reports/admin/all",
      pois: "/pois",
      bans: "/bans",
    };
    res.json(
      await upstream(`${routes[resource]}?${pagination(req.query)}`, s.token),
    );
  });
  // Denuncias recibidas por una cuenta (RF-29: asociadas al perfil del autor).
  app.get("/admin-api/social/reports/by-user/:id", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(
      await upstream(
        `/reports/by-reported-user?reportedUserId=${uuid(req.params.id)}&${pagination(req.query)}`,
        s.token,
      ),
    );
  });
  app.get("/admin-api/social/:resource/:id", async (req, res) => {
    const s = await authenticate(req, res),
      resource = z
        .enum(["posts", "comments", "reports", "pois"])
        .parse(req.params.resource);
    res.json(await upstream(`/${resource}/${uuid(req.params.id)}`, s.token));
  });
  app.get("/admin-api/social/posts/:id/comments", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(
      await upstream(
        `/comments?postId=${uuid(req.params.id)}&${pagination(req.query)}`,
        s.token,
      ),
    );
  });
  app.get("/admin-api/social/comments/:id/replies", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(
      await upstream(
        `/comments/${uuid(req.params.id)}/replies?${pagination(req.query)}`,
        s.token,
      ),
    );
  });
  app.put("/admin-api/social/:resource/:id/:action", async (req, res, next) => {
    if (req.params.resource === "reports") return next();
    const s = await authenticate(req, res),
      resource = z.enum(["posts", "comments"]).parse(req.params.resource),
      action = z
        .enum(["toggle-hidden", "toggle-banned"])
        .parse(req.params.action);
    res.json(
      await upstream(
        `/${resource}/${uuid(req.params.id)}/${action}`,
        s.token,
        "PUT",
      ),
    );
  });
  app.delete("/admin-api/social/:resource/:id", async (req, res) => {
    const s = await authenticate(req, res),
      resource = z
        .enum(["posts", "comments", "pois"])
        .parse(req.params.resource);
    await upstream(`/${resource}/${uuid(req.params.id)}`, s.token, "DELETE");
    res.sendStatus(204);
  });
  app.put("/admin-api/social/reports/:id/status", async (req, res) => {
    const s = await authenticate(req, res),
      body = z
        .object({
          status: z.enum(["PENDING", "UNDER_REVIEW", "RESOLVED", "REJECTED"]),
        })
        .strict()
        .parse(req.body);
    res.json(
      await upstream(
        `/reports/${uuid(req.params.id)}/status`,
        s.token,
        "PUT",
        body,
      ),
    );
  });
  app.post("/admin-api/social/pois", async (req, res) => {
    const s = await authenticate(req, res),
      body = poiSchema.parse(req.body);
    try {
      res.status(201).json(await upstream("/pois", s.token, "POST", body));
    } catch (e) {
      const ring = body.polygonCoordinates ?? [];
      if (
        !(e instanceof HttpError) ||
        e.status !== 400 ||
        body.geometryType !== "POLYGON" ||
        ring.length < 4
      )
        throw e;
      // Solución temporal: PoiService.validateGeometry compara los Double del
      // primer y último vértice con != (referencias, no valores) y rechaza
      // todo polígono cerrado. El polígono ya se validó aquí (simple, cerrado
      // y dentro del campus), así que se crea como punto y se convierte en
      // polígono con la edición, que no tiene esa comparación. Retirar cuando
      // el backend use equals()/Double.compare.
      const vertices = ring.slice(0, -1);
      const center = {
        centerLatitude:
          vertices.reduce((a, v) => a + v.latitude, 0) / vertices.length,
        centerLongitude:
          vertices.reduce((a, v) => a + v.longitude, 0) / vertices.length,
      };
      const { polygonCoordinates, ...rest } = body;
      const created = await upstream<{ id: string }>("/pois", s.token, "POST", {
        ...rest,
        geometryType: "POINT",
        ...center,
        radiusMeters: 1,
      });
      try {
        const { geometryType: _type, ...update } = body;
        res.status(201).json(
          await upstream(`/pois/${uuid(created.id)}`, s.token, "PUT", {
            ...update,
            polygonCoordinates,
          }),
        );
      } catch (inner) {
        await upstream(`/pois/${uuid(created.id)}`, s.token, "DELETE").catch(
          () => undefined,
        );
        throw inner;
      }
    }
  });
  app.put("/admin-api/social/pois/:id", async (req, res) => {
    const s = await authenticate(req, res),
      { geometryType, ...body } = poiSchema.parse(req.body);
    res.json(
      await upstream(`/pois/${uuid(req.params.id)}`, s.token, "PUT", body),
    );
  });
  app.post("/admin-api/social/bans", async (req, res) => {
    const s = await authenticate(req, res),
      body = z
        .object({
          userId: z.uuid(),
          reason: z.string().trim().min(1).max(2000),
          banType: z.enum(["TEMPORAL", "PERMANENT"]),
          expiresAt: z.iso.datetime().optional(),
        })
        .strict()
        .parse(req.body);
    const target = await upstream<User>(`/users/${body.userId}`, s.token);
    if (
      target.role === "SUPERADMIN" ||
      target.username === "superadmin" ||
      target.id === s.user.id
    )
      throw new HttpError(409, "No puedes suspender esta cuenta protegida.");
    if (
      body.banType === "TEMPORAL" &&
      (!body.expiresAt || Date.parse(body.expiresAt) <= Date.now())
    )
      throw new HttpError(
        400,
        "La suspensión temporal requiere una fecha futura.",
      );
    res.status(201).json(await upstream("/bans", s.token, "POST", body));
  });
  app.patch("/admin-api/social/bans/:id/cancel", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(
      await upstream(`/bans/${uuid(req.params.id)}/cancel`, s.token, "PATCH"),
    );
  });
  app.get("/admin-api/social/users/:id/bans", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(
      await upstream(
        `/bans/user/${uuid(req.params.id)}?${pagination(req.query)}`,
        s.token,
      ),
    );
  });
  app.delete("/admin-api/social/users/:id/media/:type", async (req, res) => {
    const s = await authenticate(req, res),
      type = z.enum(["profile-picture", "banner"]).parse(req.params.type),
      target = await upstream<User>(`/users/${uuid(req.params.id)}`, s.token);
    if (target.role === "SUPERADMIN" || target.username === "superadmin")
      throw new HttpError(409, "La cuenta inicial está protegida.");
    res.json(
      await upstream(
        `/users/@${encodeURIComponent(target.username)}/media?type=${type}`,
        s.token,
        "DELETE",
      ),
    );
  });
}
