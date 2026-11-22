import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app";
import type { Upstream } from "../../server/upstream";

const id = "943e5eda-be65-40bc-b896-a4daad3f3d85";
const target = "543e5eda-be65-40bc-b896-a4daad3f3d85";
const origin = "http://localhost:5173";
const page = <T>(content: T[], totalPages = 1) => ({
  content,
  pagination: { page: 0, size: 100, totalElements: content.length, totalPages },
});
function setup(
  extra: (path: string, method: string, body?: unknown) => unknown,
) {
  const calls = vi.fn(
    async (path: string, _token?: string, method = "GET", body?: unknown) => {
      if (path === "/auth/login")
        return {
          token: "private-token",
          expiresIn: new Date(Date.now() + 3600000).toISOString(),
        };
      if (path === "/users/me")
        return { id, role: "ADMIN", username: "admin", email: "a@x.test" };
      return extra(path, method, body);
    },
  );
  const app = createApp({ upstream: calls as Upstream, origin });
  const agent = request.agent(app);
  return {
    agent,
    calls,
    login: () =>
      agent
        .post("/admin-api/login")
        .set("Origin", origin)
        .send({ email: "a@x.test", password: "test-only" }),
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("Gamificación conectada al servidor", () => {
  it("lee todas las páginas de logros", async () => {
    const s = setup((path) =>
      path.startsWith("/achievements?page=0")
        ? page([{ id: "a" }], 2)
        : page([{ id: "b" }], 2),
    );
    await s.login();
    const r = await s.agent.get("/admin-api/achievements");
    expect(r.body.map((a: { id: string }) => a.id)).toEqual(["a", "b"]);
  });
  it("crea misiones de evento con predicado y rechaza fechas en diarias", async () => {
    const s = setup((_p, method, body) =>
      method === "POST" ? { id, ...(body as object) } : page([]),
    );
    await s.login();
    const ok = await s.agent
      .post("/admin-api/missions")
      .set("Origin", origin)
      .send({
        slug: "semana-verde",
        name: "Semana verde",
        description: "",
        xpReward: 15,
        type: "EVENT",
        startTime: "2030-01-01T08:00:00.000Z",
        endTime: "2030-01-08T08:00:00.000Z",
        metric: "observations",
        target: 3,
      });
    expect(ok.status).toBe(201);
    expect(s.calls).toHaveBeenCalledWith(
      "/missions",
      "private-token",
      "POST",
      expect.objectContaining({
        type: "EVENT",
        predicate: { metric: "observations", op: "gte", value: 3 },
      }),
    );
    const bad = await s.agent
      .post("/admin-api/missions")
      .set("Origin", origin)
      .send({
        slug: "diaria",
        name: "Diaria",
        xpReward: 5,
        type: "DAILY",
        startTime: "2030-01-01T08:00:00.000Z",
        metric: "posts",
        target: 1,
      });
    expect(bad.status).toBe(400);
  });
  it("sube la imagen al enlace firmado y devuelve solo la clave", async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", put);
    const s = setup((path) =>
      path === "/motd/funfacts/presign"
        ? {
            key: "motd/abc.jpg",
            url: "https://bucket.example/abc",
            method: "PUT",
          }
        : page([]),
    );
    await s.login();
    const r = await s.agent
      .post("/admin-api/funfacts/images")
      .set("Origin", origin)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from([0xff, 0xd8, 0xff]));
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ key: "motd/abc.jpg" });
    expect(put).toHaveBeenCalledWith(
      "https://bucket.example/abc",
      expect.objectContaining({ method: "PUT" }),
    );
    const svg = await s.agent
      .post("/admin-api/funfacts/images")
      .set("Origin", origin)
      .set("Content-Type", "image/svg+xml")
      .send("<svg/>");
    expect(svg.status).toBe(400);
  });
});

describe("Suspensiones", () => {
  it("reactivar cancela todas las suspensiones activas", async () => {
    const s = setup((path, method) => {
      if (path.startsWith(`/bans/user/${target}`))
        return page([
          { id: "b1", status: "ACTIVE", expiresAt: null },
          { id: "b2", status: "CANCELLED", expiresAt: null },
        ]);
      if (method === "PATCH") return { id: "b1", status: "CANCELLED" };
      return page([]);
    });
    await s.login();
    const r = await s.agent
      .post(`/admin-api/social/users/${target}/reactivate`)
      .set("Origin", origin);
    expect(r.body).toEqual({ cancelled: 1 });
    expect(s.calls).toHaveBeenCalledWith(
      "/bans/b1/cancel",
      "private-token",
      "PATCH",
    );
    expect(s.calls).not.toHaveBeenCalledWith(
      "/bans/b2/cancel",
      expect.anything(),
      expect.anything(),
    );
  });
  it("no permite una segunda suspensión activa", async () => {
    const s = setup((path) => {
      if (path === `/users/${target}`)
        return { id: target, role: "USER", username: "ana" };
      if (path.startsWith(`/bans/user/${target}`))
        return page([{ id: "b1", status: "ACTIVE", expiresAt: null }]);
      return page([]);
    });
    await s.login();
    const r = await s.agent
      .post("/admin-api/social/bans")
      .set("Origin", origin)
      .send({ userId: target, reason: "Spam", banType: "PERMANENT" });
    expect(r.status).toBe(409);
  });
  it("el listado de usuarios trae la suspensión vigente con su fecha", async () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const s = setup((path) => {
      if (path.startsWith("/users?"))
        return page([
          { id: target, role: "USER", username: "ana", gender: "F" },
        ]);
      if (path.startsWith("/bans?"))
        return page([
          {
            id: "b1",
            userId: target,
            status: "ACTIVE",
            banType: "TEMPORAL",
            reason: "Spam",
            expiresAt: until,
            createdAt: until,
          },
        ]);
      return page([]);
    });
    await s.login();
    const r = await s.agent.get("/admin-api/resources/users");
    expect(r.body.content[0]).toMatchObject({
      status: "SUSPENDED",
      ban: { id: "b1", expiresAt: until },
    });
    expect(r.body.content[0].gender).toBeUndefined();
  });
});

describe("Filtros de moderación", () => {
  it("filtra denuncias por estado, tipo, motivo y texto sin tildes", async () => {
    const rows = [
      {
        id: "1",
        status: "PENDING",
        reportType: "POST",
        reason: "Spam: enlaces",
        reportedUserUsername: "ana",
        createdAt: "2026-11-01T00:00:00Z",
      },
      {
        id: "2",
        status: "RESOLVED",
        reportType: "POST",
        reason: "Spam",
        reportedUserUsername: "beto",
        createdAt: "2026-11-02T00:00:00Z",
      },
      {
        id: "3",
        status: "PENDING",
        reportType: "COMMENT",
        reason: "Información falsa: dato",
        reportedUserUsername: "ana",
        createdAt: "2026-11-03T00:00:00Z",
      },
    ];
    const s = setup((path) =>
      path.startsWith("/reports/admin/all") ? page(rows) : page([]),
    );
    await s.login();
    const spam = await s.agent.get(
      "/admin-api/social/reports?status=PENDING&reason=Spam",
    );
    expect(spam.body.content.map((r: { id: string }) => r.id)).toEqual(["1"]);
    const text = await s.agent.get(
      "/admin-api/social/reports?q=informacion&type=COMMENT",
    );
    expect(text.body.content.map((r: { id: string }) => r.id)).toEqual(["3"]);
    expect(text.body.pagination.totalElements).toBe(1);
  });
  it("ordena publicaciones por votos y filtra bloqueadas", async () => {
    const posts = [
      {
        id: "a",
        title: "Colibrí",
        totalLikes: 2,
        totalDislikes: 0,
        banned: false,
        createdAt: "2026-11-01T00:00:00Z",
      },
      {
        id: "b",
        title: "Roble",
        totalLikes: 9,
        totalDislikes: 1,
        banned: false,
        createdAt: "2026-11-02T00:00:00Z",
      },
      {
        id: "c",
        title: "Spam",
        totalLikes: 0,
        totalDislikes: 5,
        banned: true,
        createdAt: "2026-11-03T00:00:00Z",
      },
    ];
    const s = setup((path) =>
      path.startsWith("/posts/admin") ? page(posts) : page([]),
    );
    await s.login();
    const r = await s.agent.get(
      "/admin-api/social/posts?state=visible&sort=votes",
    );
    expect(r.body.content.map((p: { id: string }) => p.id)).toEqual(["b", "a"]);
  });
});

describe("Perfil completo", () => {
  it("el detalle del usuario llega con foto y banner (no lo intercepta la ruta genérica)", async () => {
    const s = setup((path) =>
      path === `/users/${target}`
        ? {
            id: target,
            role: "USER",
            username: "ana",
            gender: "F",
            profilePictureUrl: "https://img.test/a.jpg",
            bannerUrl: "https://img.test/b.jpg",
          }
        : page([]),
    );
    await s.login();
    const r = await s.agent.get(`/admin-api/social/users/${target}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      profilePictureUrl: "https://img.test/a.jpg",
      bannerUrl: "https://img.test/b.jpg",
    });
    expect(r.body.gender).toBeUndefined();
    const post = await s.agent.get(`/admin-api/social/users/${target}/posts`);
    expect(post.status).toBe(200);
  });
});
