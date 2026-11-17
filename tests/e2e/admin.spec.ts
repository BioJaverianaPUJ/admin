import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
const admin = {
  id: "943e5eda-be65-40bc-b896-a4daad3f3d85",
  firstName: "Brayan",
  lastName: "Fajardo",
  username: "brayan",
  email: "brayan@example.test",
  role: "ADMIN",
  gender: "MALE",
};
const species = [
  {
    id: "843e5eda-be65-40bc-b896-a4daad3f3d85",
    scientificName: "Quercus humboldtii",
    commonName: "Roble colombiano",
    family: "Fagaceae",
    woodDensity: 0.65,
  },
  {
    id: "743e5eda-be65-40bc-b896-a4daad3f3d85",
    scientificName: "Tibouchina lepidota",
    commonName: "Sietecueros",
    family: "Melastomataceae",
    woodDensity: 0.55,
  },
  {
    id: "643e5eda-be65-40bc-b896-a4daad3f3d85",
    scientificName: "Alnus acuminata",
    commonName: "Aliso",
    family: "Betulaceae",
    woodDensity: 0.4,
  },
];
async function mock(page: Page, authenticated = true) {
  let signed = authenticated;
  const writes: string[] = [];
  await page.route("**/admin-api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    let body: unknown = {},
      status = 200;
    if (path.endsWith("/session")) {
      status = signed ? 200 : 401;
      body = signed ? { user: admin } : { message: "Inicia sesión" };
    } else if (path.endsWith("/login")) {
      signed = true;
      body = { user: admin };
    } else if (path.endsWith("/logout")) {
      signed = false;
      status = 204;
    } else if (path.includes("/social/")) {
      body = {
        content: [],
        pagination: {
          page: 0,
          size: 12,
          totalPages: 0,
          totalElements: 0,
          first: true,
          last: true,
        },
      };
    } else if (path.endsWith("/options/species")) body = species;
    else if (path.includes("/resources/")) {
      if (req.method() !== "GET") {
        writes.push(path);
        body = { id: crypto.randomUUID(), ...req.postDataJSON() };
      } else {
        const rows = path.includes("users")
          ? [
              admin,
              {
                ...admin,
                id: "543e5eda-be65-40bc-b896-a4daad3f3d85",
                role: "USER",
                username: "explorador",
                firstName: "Ana",
                lastName: "Pérez",
              },
            ]
          : path.includes("specimens")
            ? []
            : species;
        body = {
          content: rows,
          pagination: {
            page: 0,
            size: 12,
            totalElements: rows.length,
            totalPages: 1,
            first: true,
            last: true,
          },
        };
      }
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: status === 204 ? "" : JSON.stringify(body),
    });
  });
  return writes;
}
test("login, catálogo, formulario real y cierre de sesión", async ({
  page,
}) => {
  await mock(page, false);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bienvenido de nuevo." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/login-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Correo electrónico").fill("admin@example.test");
  await page.getByLabel("Contraseña *", { exact: true }).fill("test-only");
  await page.getByRole("button", { name: "Entrar al módulo" }).click();
  await expect(
    page.getByText("Roble colombiano", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/catalogo-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Nueva especie", exact: true })
    .click();
  await page.getByLabel("Nombre científico").fill("Testus campus");
  await page.getByLabel("Nombre común").fill("Prueba");
  await page.getByLabel("Familia *").fill("Familia");
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(
    page.getByText("Cambios guardados en el servidor."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Entrar al módulo" }),
  ).toBeVisible();
});
test("zonas y gamificación guardan únicamente borradores locales", async ({
  page,
}) => {
  const writes = await mock(page);
  await page.goto("/#zonas");
  await page.getByRole("button", { name: "Nuevo borrador" }).click();
  await page.getByLabel("Nombre *", { exact: true }).fill("Jardín de prueba");
  await page.getByLabel("Descripción *").fill("Solo para revisión visual");
  await page.getByText("Editar coordenadas con teclado").click();
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Añadir vértice" }).click();
  await page
    .getByLabel("Latitud del vértice 2", { exact: true })
    .fill("4.6285");
  await page
    .getByLabel("Longitud del vértice 3", { exact: true })
    .fill("-74.0640");
  await page.screenshot({
    path: "test-results/zona-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Guardar borrador local" }).click();
  await expect(
    page.getByText("Borrador guardado en este navegador. No se ha publicado."),
  ).toBeVisible();
  await page.getByRole("link", { name: /Gamificación/ }).click();
  await page.getByRole("button", { name: "Nuevo borrador" }).click();
  await page.getByLabel("Nombre *", { exact: true }).fill("Exploradores");
  await page.getByLabel("Descripción *").fill("Una misión de prueba");
  await page.getByLabel("Objetivo *", { exact: true }).fill("Visitar una zona");
  await page.getByRole("button", { name: "Guardar borrador local" }).click();
  await expect(page.getByText("Exploradores", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
test("usuarios, acciones protegidas y pantalla pequeña", async ({ page }) => {
  await mock(page);
  await page.goto("/#comunidad");
  await expect(
    page.getByText("@brayan", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "@brayan" })
      .getByRole("button", { name: "Eliminar", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/comunidad-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeVisible();
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("link", { name: /Catálogo de especies/ }).click();
  await expect(
    page.getByRole("heading", { name: "Conoce. Registra. Conserva." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/catalogo-mobile.png",
    fullPage: true,
  });
});

test("accesibilidad del acceso y catálogo", async ({ page }) => {
  await mock(page, false);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Entrar al módulo" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByLabel("Correo electrónico").fill("admin@example.test");
  await page.getByLabel("Contraseña *", { exact: true }).fill("test-only");
  await page.getByRole("button", { name: "Entrar al módulo" }).click();
  await expect(
    page.getByText("Roble colombiano", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("consulta revisiones reales del contrato y abre el perímetro editable", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/admin-api/observations?**", (route) =>
    route.fulfill({
      json: {
        content: [
          {
            id: "observation-test",
            latitude: 4.6286,
            longitude: -74.0637,
            checked: true,
            revisionRequested: true,
            speciesCommonName: "Roble de prueba",
            certainty: 0.98,
            observationType: "PLANT",
            imageUrl: null,
            createdAt: "2026-11-05T12:00:00Z",
          },
        ],
        page: 0,
        size: 12,
        totalElements: 1,
        totalPages: 1,
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Solicitudes de revisión" }).click();
  await expect(
    page.getByText("Roble de prueba", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ver observación" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "no incluye el estado de verificación oficial",
  );
  await page.screenshot({
    path: "test-results/observacion-actualizada.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.goto("/#zonas");
  await page
    .getByRole("button", { name: "Límite del campus", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Perímetro de referencia del campus" }),
  ).toBeVisible();
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({
    timeout: 20000,
  });
  await page.screenshot({
    path: "test-results/perimetro-campus.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Editar copia del perímetro" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Campus");
});
test("puntos de interés se guardan en el servidor y conservan la geometría", async ({
  page,
}) => {
  await mock(page);
  const saved: Record<string, unknown>[] = [];
  await page.route("**/admin-api/social/pois**", async (route) => {
    if (route.request().method() === "POST") {
      saved.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: "new-poi", ...saved[0] } });
    } else
      await route.fulfill({
        json: { content: [], pagination: { totalPages: 0, totalElements: 0 } },
      });
  });
  await page.goto("/#zonas");
  await page
    .getByRole("button", { name: "Crear punto de interés", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Nuevo punto de interés" });
  await dialog.getByLabel("Nombre *", { exact: true }).fill("Jardín de prueba");
  await dialog
    .locator(".leaflet-container")
    .click({ position: { x: 200, y: 180 } });
  await dialog.getByLabel("Latitud 1", { exact: true }).fill("4.6286");
  await dialog.getByLabel("Longitud 1", { exact: true }).fill("-74.0637");
  await dialog.getByRole("button", { name: "Guardar en el servidor" }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved[0]).toMatchObject({
    name: "Jardín de prueba",
    geometryType: "POINT",
    centerLatitude: 4.6286,
    centerLongitude: -74.0637,
  });
  await page.screenshot({
    path: "test-results/puntos-interes.png",
    fullPage: true,
  });
});
test("denuncias consultan contenido y envían el estado confirmado", async ({
  page,
}) => {
  await mock(page);
  const writes: string[] = [];
  const report = {
    id: "r1",
    reportType: "POST",
    reportedPostId: "p1",
    reason: "Spam",
    status: "PENDING",
    reportedUserUsername: "explorador",
    reporterUsername: "visitante",
    createdAt: "2026-11-15T12:00:00Z",
  };
  await page.route("**/admin-api/social/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "PUT") {
      writes.push(path);
      await route.fulfill({ json: { ...report, status: "UNDER_REVIEW" } });
      return;
    }
    if (path.endsWith("/posts/p1")) {
      await route.fulfill({
        json: {
          id: "p1",
          title: "Prueba",
          description: "Contenido reportado",
          author: { username: "explorador" },
          images: [],
        },
      });
      return;
    }
    if (path.endsWith("/reports/r1")) {
      await route.fulfill({ json: report });
      return;
    }
    await route.fulfill({
      json: {
        content: path.endsWith("/reports") ? [report] : [],
        pagination: { totalPages: 1, totalElements: 1 },
      },
    });
  });
  await page.goto("/#comunidad");
  await page.getByRole("button", { name: "Denuncias", exact: true }).click();
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(
    page.getByText("Contenido reportado", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Estado", { exact: true }).selectOption("UNDER_REVIEW");
  await page
    .getByRole("dialog", { name: "Cambiar denuncia a En revisión" })
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toEqual(["/admin-api/social/reports/r1/status"]);
});

test("un fallo de puntos de interés permite reintentar sin fingir una lista vacía", async ({
  page,
}) => {
  await mock(page);
  let available = false;
  await page.route("**/admin-api/social/pois**", async (route) => {
    await route.fulfill(
      available
        ? {
            json: {
              content: [],
              pagination: { totalPages: 0, totalElements: 0 },
            },
          }
        : { status: 502, json: { message: "El servidor no está disponible" } },
    );
  });
  await page.goto("/#zonas");
  await expect(
    page.getByText("El servidor no está disponible", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Aún no hay puntos de interés", { exact: true }),
  ).toHaveCount(0);
  available = true;
  await page
    .getByRole("button", { name: "Actualizar puntos de interés", exact: true })
    .click();
  await expect(
    page.getByText("Aún no hay puntos de interés", { exact: true }),
  ).toBeVisible();
});
