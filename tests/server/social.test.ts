import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app";
import type { Upstream } from "../../server/upstream";
const id = "943e5eda-be65-40bc-b896-a4daad3f3d85",
  other = "843e5eda-be65-40bc-b896-a4daad3f3d85";
function setup() {
  const calls = vi.fn(
    async (path: string, _token?: string, method = "GET", body?: unknown) => {
      if (path === "/auth/login")
        return {
          token: "test-only",
          expiresIn: new Date(Date.now() + 3600000).toISOString(),
        };
      if (path === "/users/me")
        return { id, role: "SUPERADMIN", username: "superadmin" };
      if (path === `/users/${other}`)
        return { id: other, role: "USER", username: "test-user" };
      if (path === `/users/${id}`)
        return { id, role: "SUPERADMIN", username: "superadmin" };
      return (
        body ?? { content: [], pagination: { totalPages: 0, totalElements: 0 } }
      );
    },
  );
  const app = createApp({
    upstream: calls as Upstream,
    origin: "http://localhost:5173",
  });
  return { calls, app };
}
async function login(agent: ReturnType<typeof request.agent>) {
  expect(
    (
      await agent
        .post("/admin-api/login")
        .set("Origin", "http://localhost:5173")
        .send({ email: "admin@example.test", password: "only-a-test" })
    ).status,
  ).toBe(200);
}
describe("Contratos sociales y administrativos actualizados", () => {
  it("acepta SUPERADMIN y conserva rutas y filtros de moderación", async () => {
    const { app, calls } = setup(),
      a = request.agent(app);
    await login(a);
    expect(
      (await a.get("/admin-api/social/reports?pending=true&page=2&size=12"))
        .status,
    ).toBe(200);
    expect(calls.mock.calls.at(-1)?.[0]).toBe(
      "/reports/admin/pending?page=2&size=12",
    );
    expect(
      (
        await a
          .put(`/admin-api/social/reports/${other}/status`)
          .set("Origin", "http://localhost:5173")
          .send({ status: "UNDER_REVIEW" })
      ).status,
    ).toBe(200);
    expect(calls.mock.calls.at(-1)?.slice(0, 4)).toEqual([
      `/reports/${other}/status`,
      "test-only",
      "PUT",
      { status: "UNDER_REVIEW" },
    ]);
  });
  it("modera contenido con sesión y rechaza acciones no autorizadas", async () => {
    const { app, calls } = setup(),
      a = request.agent(app);
    expect((await a.get("/admin-api/social/posts")).status).toBe(401);
    await login(a);
    expect(
      (
        await a
          .put(`/admin-api/social/posts/${other}/toggle-banned`)
          .set("Origin", "http://localhost:5173")
      ).status,
    ).toBe(200);
    expect(calls.mock.calls.at(-1)?.[0]).toBe(`/posts/${other}/toggle-banned`);
    expect(
      (
        await a
          .put(`/admin-api/social/posts/${other}/unknown`)
          .set("Origin", "http://localhost:5173")
      ).status,
    ).toBe(400);
  });
  it("valida geometría antes de publicar y usa el DTO de POI", async () => {
    const { app, calls } = setup(),
      a = request.agent(app);
    await login(a);
    const body = {
      name: "Lugar de prueba",
      geometryType: "POINT",
      visibility: "PUBLIC",
      centerLatitude: 4.6286,
      centerLongitude: -74.0637,
      radiusMeters: 5,
    };
    expect(
      (
        await a
          .post("/admin-api/social/pois")
          .set("Origin", "http://localhost:5173")
          .send(body)
      ).status,
    ).toBe(201);
    expect(calls.mock.calls.at(-1)?.[0]).toBe("/pois");
    expect(
      (
        await a
          .post("/admin-api/social/pois")
          .set("Origin", "http://localhost:5173")
          .send({ ...body, centerLatitude: 5 })
      ).status,
    ).toBe(400);
  });
  it("exige motivo y fecha futura para suspensiones y protege la cuenta inicial", async () => {
    const { app } = setup(),
      a = request.agent(app);
    await login(a);
    const body = { userId: other, reason: "Prueba", banType: "TEMPORAL" };
    expect(
      (
        await a
          .post("/admin-api/social/bans")
          .set("Origin", "http://localhost:5173")
          .send(body)
      ).status,
    ).toBe(400);
    expect(
      (
        await a
          .post("/admin-api/social/bans")
          .set("Origin", "http://localhost:5173")
          .send({
            ...body,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          })
      ).status,
    ).toBe(201);
    expect(
      (
        await a
          .post("/admin-api/social/bans")
          .set("Origin", "http://localhost:5173")
          .send({ ...body, userId: id, banType: "PERMANENT" })
      ).status,
    ).toBe(409);
  });
  it("no acepta el campo enabled eliminado del contrato de usuarios", async () => {
    const { app } = setup(),
      a = request.agent(app);
    await login(a);
    expect(
      (
        await a
          .patch(`/admin-api/resources/users/${other}`)
          .set("Origin", "http://localhost:5173")
          .send({ enabled: false })
      ).status,
    ).toBe(400);
  });
});
