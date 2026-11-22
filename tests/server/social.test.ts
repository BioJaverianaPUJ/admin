import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app";
import { HttpError, type Upstream } from "../../server/upstream";
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
  it("consulta las denuncias recibidas por una cuenta", async () => {
    const { app, calls } = setup(),
      a = request.agent(app);
    await login(a);
    expect(
      (await a.get(`/admin-api/social/reports/by-user/${other}?size=100`))
        .status,
    ).toBe(200);
    expect(calls.mock.calls.at(-1)?.[0]).toBe(
      `/reports/by-reported-user?reportedUserId=${other}&page=0&size=100`,
    );
    expect(
      (await a.get("/admin-api/social/reports/by-user/no-es-uuid")).status,
    ).toBe(400);
  });
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
      type: "INTEREST_ZONE",
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

describe("RF-55: estado de las cuentas", () => {
  it("marca suspendidas, filtra por estado y no expone el género", async () => {
    const page = (content: unknown[]) => ({
      content,
      pagination: { totalPages: 1, totalElements: content.length },
    });
    const users = [
      { id, role: "SUPERADMIN", username: "superadmin", gender: "MALE" },
      { id: other, role: "USER", username: "test-user", gender: "FEMALE" },
    ];
    const calls = vi.fn(async (path: string) => {
      if (path === "/auth/login")
        return {
          token: "test-only",
          expiresIn: new Date(Date.now() + 3600000).toISOString(),
        };
      if (path === "/users/me") return users[0];
      if (path.startsWith("/users?")) return page(users);
      if (path.startsWith("/bans?"))
        return page([
          { userId: other, status: "ACTIVE", expiresAt: null },
          {
            userId: id,
            status: "ACTIVE",
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        ]);
      return page([]);
    });
    const app = createApp({
      upstream: calls as Upstream,
      origin: "http://localhost:5173",
    });
    const a = request.agent(app);
    await login(a);
    const all = await a.get("/admin-api/resources/users");
    expect(all.status).toBe(200);
    expect(all.body.content.map((u: { status: string }) => u.status)).toEqual([
      "ACTIVE",
      "SUSPENDED",
    ]);
    expect(JSON.stringify(all.body)).not.toContain("gender");
    const suspended = await a.get("/admin-api/resources/users?state=SUSPENDED");
    expect(suspended.body.content.map((u: { id: string }) => u.id)).toEqual([
      other,
    ]);
  });
});

describe("Polígonos de puntos de interés", () => {
  const poiId = "743e5eda-be65-40bc-b896-a4daad3f3d85";
  // Cuadrado pequeño dentro del perímetro de referencia, cerrado.
  const ring = [
    { latitude: 4.6284, longitude: -74.0639 },
    { latitude: 4.6284, longitude: -74.0635 },
    { latitude: 4.6288, longitude: -74.0635 },
    { latitude: 4.6288, longitude: -74.0639 },
    { latitude: 4.6284, longitude: -74.0639 },
  ];
  const polygon = {
    name: "Jardín",
    geometryType: "POLYGON",
    type: "GREEN_ZONE",
    visibility: "PUBLIC",
    polygonCoordinates: ring,
  };
  function backend(failPut = false) {
    const calls = vi.fn(
      async (path: string, _t?: string, method = "GET", body?: unknown) => {
        if (path === "/auth/login")
          return {
            token: "test-only",
            expiresIn: new Date(Date.now() + 3600000).toISOString(),
          };
        if (path === "/users/me")
          return { id, role: "ADMIN", username: "admin" };
        const b = body as { geometryType?: string } | undefined;
        // Reproduce el backend actual: rechaza todo POLYGON al crear.
        if (
          path === "/pois" &&
          method === "POST" &&
          b?.geometryType === "POLYGON"
        )
          throw new HttpError(400, "El servidor rechazó los datos.");
        if (path === "/pois" && method === "POST") return { id: poiId };
        if (method === "PUT" && failPut) throw new HttpError(500, "falló");
        return { id: poiId, ...(body as object) };
      },
    );
    const app = createApp({
      upstream: calls as Upstream,
      origin: "http://localhost:5173",
    });
    return { app, calls };
  }
  it("crea el polígono como punto y lo convierte con la edición", async () => {
    const { app, calls } = backend(),
      a = request.agent(app);
    await login(a);
    const r = await a
      .post("/admin-api/social/pois")
      .set("Origin", "http://localhost:5173")
      .send(polygon);
    expect(r.status).toBe(201);
    const writes = calls.mock.calls
      .filter((c) => c[2] && c[2] !== "GET")
      .map((c) => [
        c[0],
        c[2],
        (c[3] as { geometryType?: string })?.geometryType,
      ]);
    expect(writes.slice(-3)).toEqual([
      ["/pois", "POST", "POLYGON"],
      ["/pois", "POST", "POINT"],
      [`/pois/${poiId}`, "PUT", undefined],
    ]);
    expect(calls.mock.calls.at(-1)?.[3]).toMatchObject({
      polygonCoordinates: ring,
    });
  });
  it("si la conversión falla, borra el punto temporal", async () => {
    const { app, calls } = backend(true),
      a = request.agent(app);
    await login(a);
    const r = await a
      .post("/admin-api/social/pois")
      .set("Origin", "http://localhost:5173")
      .send(polygon);
    expect(r.status).toBe(500);
    expect(calls.mock.calls.at(-1)?.slice(0, 1)).toEqual([`/pois/${poiId}`]);
    expect(calls.mock.calls.at(-1)?.[2]).toBe("DELETE");
  });
});

describe("Catálogo: resumen de ejemplares y filtro de salud", () => {
  it("cuenta ejemplares por especie y filtra por estado", async () => {
    const sp1 = "11111111-1111-4111-8111-111111111111";
    const sp2 = "22222222-2222-4222-8222-222222222222";
    const specimens = [
      { id: "a", speciesId: sp1, healthStatus: "WELL" },
      { id: "b", speciesId: sp1, healthStatus: "POOR" },
      { id: "c", speciesId: sp2, healthStatus: null },
    ];
    const calls = vi.fn(async (path: string) => {
      if (path === "/auth/login")
        return {
          token: "test-only",
          expiresIn: new Date(Date.now() + 3600000).toISOString(),
        };
      if (path === "/users/me") return { id, role: "ADMIN", username: "a" };
      if (path.startsWith("/specimens?"))
        return {
          content: specimens,
          pagination: { totalPages: 1, totalElements: 3 },
        };
      return { content: [], pagination: { totalPages: 1, totalElements: 0 } };
    });
    const app = createApp({
      upstream: calls as Upstream,
      origin: "http://localhost:5173",
    });
    const a = request.agent(app);
    await login(a);
    const stats = await a.get("/admin-api/catalog/stats");
    expect(stats.body.totalSpecimens).toBe(3);
    expect(stats.body.bySpecies[sp1]).toEqual({
      total: 2,
      health: { WELL: 1, POOR: 1 },
    });
    expect(stats.body.health.UNKNOWN).toBe(1);
    const poor = await a.get("/admin-api/resources/specimens?health=POOR");
    expect(poor.body.content.map((s: { id: string }) => s.id)).toEqual(["b"]);
  });
});
