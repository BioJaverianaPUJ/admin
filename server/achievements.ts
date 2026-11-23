import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { User } from "../shared/types";
import {
  achievementPayload,
  achievementUpdatePayload,
} from "../shared/achievements";
import { checkPredicate } from "../shared/predicate";
import { HttpError, collectPages, type Upstream } from "./upstream";

export function registerAchievementRoutes(
  app: Express,
  authenticate: (
    req: Request,
    res: Response,
  ) => Promise<{ token: string; user: User }>,
  upstream: Upstream,
) {
  async function forward(
    path: string,
    token: string,
    method = "GET",
    body?: unknown,
  ) {
    try {
      return await upstream(path, token, method, body);
    } catch (e) {
      if (
        path === "/achievements" &&
        e instanceof HttpError &&
        [404, 501].includes(e.status)
      ) {
        throw new HttpError(
          501,
          "Los logros todavía no están habilitados en el backend desplegado.",
        );
      }
      throw e;
    }
  }
  app.get("/admin-api/achievements", async (req, res) => {
    const s = await authenticate(req, res);
    try {
      res.json(await collectPages(upstream, "/achievements", s.token));
    } catch (e) {
      if (e instanceof HttpError && [404, 501].includes(e.status))
        throw new HttpError(
          501,
          "Los logros todavía no están habilitados en el backend desplegado.",
        );
      throw e;
    }
  });
  app.post("/admin-api/achievements", async (req, res) => {
    const s = await authenticate(req, res);
    res
      .status(201)
      .json(
        await forward(
          "/achievements",
          s.token,
          "POST",
          achievementPayload(req.body),
        ),
      );
  });
  // Prueba una condición contra una cuenta real sin guardar nada.
  app.post("/admin-api/achievements/preview", async (req, res) => {
    const s = await authenticate(req, res);
    const body = z
      .object({ userId: z.uuid(), predicate: z.unknown() })
      .strict()
      .parse(req.body);
    const checked = checkPredicate(body.predicate);
    if (!checked.ok) throw new HttpError(400, checked.error);
    res.json(
      await forward("/achievements/preview", s.token, "POST", {
        userId: body.userId,
        predicate: checked.predicate,
      }),
    );
  });
  app.put("/admin-api/achievements/:id", async (req, res) => {
    const s = await authenticate(req, res);
    const id = z.uuid().parse(req.params.id);
    const body = achievementUpdatePayload(req.body);
    res.json(await forward(`/achievements/${id}`, s.token, "PUT", body));
  });
  app.delete("/admin-api/achievements/:id", async (req, res) => {
    const s = await authenticate(req, res);
    await forward(
      `/achievements/${z.uuid().parse(req.params.id)}`,
      s.token,
      "DELETE",
    );
    res.sendStatus(204);
  });
}
