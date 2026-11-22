import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import type { User } from "../shared/types";
import {
  funFactSchema,
  funFactUpdateSchema,
  missionPayload,
  missionUpdatePayload,
} from "../shared/gamification";
import { HttpError, collectPages, type Upstream } from "./upstream";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];

/** Misiones (RF-49) y datos curiosos (RF-51) conectados al backend. */
export function registerGamificationRoutes(
  app: Express,
  authenticate: (
    req: Request,
    res: Response,
  ) => Promise<{ token: string; user: User }>,
  upstream: Upstream,
) {
  const uuid = (v: unknown) => z.uuid().parse(v);
  // ---------- Misiones ----------
  app.get("/admin-api/missions", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(await collectPages(upstream, "/missions", s.token));
  });
  app.post("/admin-api/missions", async (req, res) => {
    const s = await authenticate(req, res);
    res
      .status(201)
      .json(
        await upstream("/missions", s.token, "POST", missionPayload(req.body)),
      );
  });
  app.put("/admin-api/missions/:id", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(
      await upstream(
        `/missions/${uuid(req.params.id)}`,
        s.token,
        "PUT",
        missionUpdatePayload(req.body),
      ),
    );
  });
  app.delete("/admin-api/missions/:id", async (req, res) => {
    const s = await authenticate(req, res);
    await upstream(`/missions/${uuid(req.params.id)}`, s.token, "DELETE");
    res.sendStatus(204);
  });

  // ---------- Datos curiosos ----------
  app.get("/admin-api/funfacts", async (req, res) => {
    const s = await authenticate(req, res);
    // El resumen del backend no dice si está oculto ni trae la zona: se
    // completa con el detalle de cada dato (son pocos registros).
    const list = await collectPages<{ id: string }>(
      upstream,
      "/motd/funfacts",
      s.token,
    );
    const detailed: unknown[] = new Array(list.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(6, list.length) }, async () => {
        while (next < list.length) {
          const i = next++;
          detailed[i] = await upstream(
            `/motd/funfacts/${list[i].id}`,
            s.token,
          ).catch(() => list[i]);
        }
      }),
    );
    res.json(detailed);
  });
  app.get("/admin-api/funfacts/today", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(await upstream("/motd/today", s.token));
  });
  app.get("/admin-api/funfacts/:id", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(await upstream(`/motd/funfacts/${uuid(req.params.id)}`, s.token));
  });
  app.post("/admin-api/funfacts", async (req, res) => {
    const s = await authenticate(req, res);
    res
      .status(201)
      .json(
        await upstream(
          "/motd/funfacts",
          s.token,
          "POST",
          funFactSchema.parse(req.body),
        ),
      );
  });
  app.put("/admin-api/funfacts/:id", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(
      await upstream(
        `/motd/funfacts/${uuid(req.params.id)}`,
        s.token,
        "PUT",
        funFactUpdateSchema.parse(req.body),
      ),
    );
  });
  app.put("/admin-api/funfacts/:id/toggle-hidden", async (req, res) => {
    const s = await authenticate(req, res);
    res.json(
      await upstream(
        `/motd/funfacts/${uuid(req.params.id)}/toggle-hidden`,
        s.token,
        "PUT",
      ),
    );
  });
  app.delete("/admin-api/funfacts/:id", async (req, res) => {
    const s = await authenticate(req, res);
    await upstream(`/motd/funfacts/${uuid(req.params.id)}`, s.token, "DELETE");
    res.sendStatus(204);
  });
  // La imagen pasa por este servidor: se firma la carga en el backend y se
  // envía al almacenamiento sin exponer el token ni depender de CORS.
  app.post(
    "/admin-api/funfacts/images",
    express.raw({ type: imageTypes, limit: "5mb" }),
    async (req, res) => {
      const s = await authenticate(req, res);
      const contentType = String(req.headers["content-type"] ?? "");
      if (!imageTypes.includes(contentType) || !Buffer.isBuffer(req.body))
        throw new HttpError(400, "Sube una imagen JPG, PNG o WebP.");
      const signed = await upstream<{
        key: string;
        url: string;
        method?: string;
      }>("/motd/funfacts/presign", s.token, "POST", { contentType });
      if (!signed?.url || !signed?.key)
        throw new HttpError(
          502,
          "El servidor no preparó la carga de la imagen.",
        );
      const put = await fetch(signed.url, {
        method: signed.method ?? "PUT",
        headers: { "Content-Type": contentType },
        body: new Uint8Array(req.body),
        redirect: "error",
      }).catch(() => null);
      if (!put?.ok)
        throw new HttpError(
          502,
          "No se pudo guardar la imagen. Intenta de nuevo.",
        );
      res.status(201).json({ key: signed.key });
    },
  );
}
