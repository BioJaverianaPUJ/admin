import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpstream } from "../../server/upstream";
afterEach(() => vi.unstubAllGlobals());
describe("errores de acceso del backend", () => {
  it("explica un 502 vacío sin confundirlo con credenciales incorrectas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 502 })),
    );
    await expect(
      createUpstream("https://api.test/api/v1")(
        "/auth/login",
        undefined,
        "POST",
        {},
      ),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining(
        "backend de BioJaveriana no está disponible (502)",
      ),
    });
  });
  it("distingue credenciales incorrectas de una sesión vencida", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(null, { status: 401 })),
        ),
    );
    const upstream = createUpstream("https://api.test/api/v1");
    await expect(upstream("/auth/login")).rejects.toMatchObject({
      message: "Correo o contraseña incorrectos.",
    });
    await expect(upstream("/users/me")).rejects.toMatchObject({
      message: "La sesión terminó.",
    });
  });
});
