import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app";
import { HttpError, type Upstream } from "../../server/upstream";

const id = "943e5eda-be65-40bc-b896-a4daad3f3d85";
const origin = "http://localhost:5173";
function setup(failure?: HttpError) {
  const calls = vi.fn(
    async (path: string, _token?: string, method = "GET", body?: unknown) => {
      if (path === "/auth/login")
        return {
          token: "private-token",
          expiresIn: new Date(Date.now() + 3600000).toISOString(),
        };
      if (path === "/users/me")
        return {
          id,
          role: "ADMIN",
          username: "admin",
          email: "admin@example.test",
        };
      if (failure) throw failure;
      return method === "GET" ? [] : { id, ...(body as object) };
    },
  );
  const app = createApp({ upstream: calls as Upstream, origin });
  const agent = request.agent(app);
  return {
    app,
    agent,
    calls,
    login: () =>
      agent
        .post("/admin-api/login")
        .set("Origin", origin)
        .send({ email: "admin@example.test", password: "test-only" }),
  };
}
const draft = {
  slug: "primera-observacion",
  name: "Primera observación",
  description: "Registra una especie",
  xpReward: 10,
  metric: "observations",
  target: 1,
};
describe("Contrato de logros", () => {
  it("requiere sesión administrativa", async () => {
    const s = setup();
    expect((await request(s.app).get("/admin-api/achievements")).status).toBe(
      401,
    );
    expect(s.calls).not.toHaveBeenCalled();
  });
  it("crea la regla exacta del backend sin exponer la sesión", async () => {
    const s = setup();
    await s.login();
    const r = await s.agent
      .post("/admin-api/achievements")
      .set("Origin", origin)
      .send(draft);
    expect(r.status).toBe(201);
    expect(s.calls).toHaveBeenLastCalledWith(
      "/achievements",
      "private-token",
      "POST",
      {
        slug: draft.slug,
        name: draft.name,
        description: draft.description,
        xpReward: 10,
        // Formato de PredicateCodec en el backend: { metric, op, value }.
        predicate: { metric: "observations", op: "gte", value: 1 },
      },
    );
    expect(JSON.stringify(r.body)).not.toContain("private-token");
  });
  it("rechaza reglas arbitrarias y recompensas inválidas", async () => {
    const s = setup();
    await s.login();
    for (const change of [
      { target: 0 },
      { xpReward: -1 },
      // RF-50: solo 5, 10, 15 o 20 de experiencia.
      { xpReward: 12 },
      { metric: "arbitrary" },
    ]) {
      expect(
        (
          await s.agent
            .post("/admin-api/achievements")
            .set("Origin", origin)
            .send({ ...draft, ...change })
        ).status,
      ).toBe(400);
    }
    expect(s.calls.mock.calls.some((c) => c[0] === "/achievements")).toBe(
      false,
    );
  });
  it("editar conserva las reglas existentes y rechaza campos no admitidos", async () => {
    const s = setup();
    await s.login();
    expect(
      (
        await s.agent
          .put(`/admin-api/achievements/${id}`)
          .set("Origin", origin)
          .send({ active: false })
      ).status,
    ).toBe(200);
    expect(s.calls).toHaveBeenLastCalledWith(
      `/achievements/${id}`,
      "private-token",
      "PUT",
      { active: false },
    );
    expect(
      (
        await s.agent
          .put(`/admin-api/achievements/${id}`)
          .set("Origin", origin)
          .send({ predicateJson: "{}" })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.agent
          .put(`/admin-api/achievements/${id}`)
          .set("Origin", origin)
          .send({ metric: "posts", target: 3, xpReward: 15 })
      ).status,
    ).toBe(200);
    expect(s.calls).toHaveBeenLastCalledWith(
      `/achievements/${id}`,
      "private-token",
      "PUT",
      { xpReward: 15, predicate: { metric: "posts", op: "gte", value: 3 } },
    );
    expect(
      (
        await s.agent
          .put(`/admin-api/achievements/${id}`)
          .set("Origin", origin)
          .send({ metric: "posts" })
      ).status,
    ).toBe(400);
  });
  it("guarda condiciones compuestas y explica por qué rechaza una inválida", async () => {
    const s = setup();
    await s.login();
    const predicate = {
      and: [
        { metric: "observations", op: "gte", value: 5 },
        {
          or: [
            { metric: "posts", op: "gte", value: 2 },
            { not: { metric: "comments", op: "lt", value: 1 } },
          ],
        },
      ],
    };
    const { metric: _m, target: _t, ...rest } = draft;
    const ok = await s.agent
      .post("/admin-api/achievements")
      .set("Origin", origin)
      .send({ ...rest, predicate });
    expect(ok.status).toBe(201);
    expect(s.calls).toHaveBeenLastCalledWith(
      "/achievements",
      "private-token",
      "POST",
      {
        slug: draft.slug,
        name: draft.name,
        description: draft.description,
        xpReward: 10,
        predicate,
      },
    );
    const bad = await s.agent
      .post("/admin-api/achievements")
      .set("Origin", origin)
      .send({ ...rest, predicate: { or: [] } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain("incompleta");
  });
  it("prueba una condición con una cuenta sin guardarla", async () => {
    const s = setup();
    await s.login();
    const predicate = { metric: "posts", op: "gte", value: 1 };
    const r = await s.agent
      .post("/admin-api/achievements/preview")
      .set("Origin", origin)
      .send({ userId: id, predicate });
    expect(r.status).toBe(200);
    expect(s.calls).toHaveBeenLastCalledWith(
      "/achievements/preview",
      "private-token",
      "POST",
      { userId: id, predicate },
    );
    expect(
      (
        await s.agent
          .post("/admin-api/achievements/preview")
          .set("Origin", origin)
          .send({ userId: "x", predicate })
      ).status,
    ).toBe(400);
  });
  it("distingue falta de despliegue de un fallo del servidor", async () => {
    for (const [upstreamStatus, expected] of [
      [404, 501],
      [500, 500],
      [403, 403],
    ]) {
      const s = setup(new HttpError(upstreamStatus, "Error de prueba"));
      await s.login();
      expect((await s.agent.get("/admin-api/achievements")).status).toBe(
        expected,
      );
    }
  });
});
