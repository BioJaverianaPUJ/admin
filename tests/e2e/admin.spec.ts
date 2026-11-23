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
    } else if (path.endsWith("/achievements")) {
      status = 501;
      body = { message: "Pendiente de despliegue" };
    } else if (path.endsWith("/campus/overview")) {
      body = {
        species,
        specimens: [
          {
            id: "s1",
            speciesId: species[0].id,
            latitude: 4.6286,
            longitude: -74.0637,
            circumference: 80,
            height: 9,
            healthStatus: "WELL",
            notes: "",
            observationDate: null,
            createdAt: "2026-11-01T12:00:00Z",
          },
        ],
        pois: [],
        sightings: [],
      };
    } else if (path.endsWith("/missions") || path.endsWith("/funfacts")) {
      body = [];
    } else if (path.endsWith("/funfacts/today")) {
      body = { displayDate: "2026-11-22", funFact: null };
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
test("zonas muestran el mapa general y las misiones se crean en el servidor", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/#zonas");
  const overview = page.getByRole("region", {
    name: "Mapa general del campus",
  });
  await expect(
    overview.getByText("Especímenes", { exact: true }),
  ).toBeVisible();
  await expect(
    overview.locator(".leaflet-overlay-pane canvas").first(),
  ).toBeVisible();
  await expect(page.getByText(/borrador/i)).toHaveCount(0);
  await page.screenshot({
    path: "test-results/zonas-mapa.png",
    fullPage: true,
  });
  let payload: Record<string, unknown> | null = null;
  await page.route("**/admin-api/missions", async (route) => {
    if (route.request().method() === "POST") {
      payload = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: "m1", ...payload } });
    }
    return route.fulfill({
      json: payload
        ? [
            {
              id: "m1",
              ...payload,
              predicate: { metric: "observations", op: "gte", value: 3 },
              active: true,
            },
          ]
        : [],
    });
  });
  await page.getByRole("link", { name: /Gamificación/ }).click();
  await page.getByRole("button", { name: "Nueva misión" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva misión" });
  await dialog.getByLabel("Identificador único").fill("semana-verde");
  await dialog.getByLabel("Tipo de misión").selectOption("EVENT");
  await dialog.getByLabel("Nombre", { exact: true }).fill("Semana verde");
  await dialog.getByLabel("Cantidad", { exact: true }).fill("3");
  // Las zonas visitadas no se miden por periodo: no se ofrecen en misiones.
  await expect(
    dialog.getByRole("option", { name: /Zonas del campus visitadas/ }),
  ).toBeDisabled();
  await dialog.getByLabel("Inicio del evento").fill("2030-01-01T08:00");
  await dialog.getByLabel("Fin del evento").fill("2030-01-08T08:00");
  await dialog.getByRole("button", { name: "Crear misión" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Semana verde" }),
  ).toBeVisible();
  expect(payload).toMatchObject({
    slug: "semana-verde",
    type: "EVENT",
    predicate: { metric: "observations", op: "gte", value: 3 },
    xpReward: 10,
  });
  expect(typeof (payload as unknown as { startTime: string }).startTime).toBe(
    "string",
  );
  await page.screenshot({ path: "test-results/misiones.png", fullPage: true });
});
test("perfil completo con banner y quitar una suspensión", async ({ page }) => {
  await mock(page);
  const suspended = {
    ...admin,
    id: "543e5eda-be65-40bc-b896-a4daad3f3d85",
    role: "USER",
    username: "explorador",
    firstName: "Ana",
    lastName: "Pérez",
    status: "SUSPENDED",
    ban: {
      id: "b1",
      ids: ["b1"],
      reason: "Spam",
      banType: "TEMPORAL",
      expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    },
  };
  const page1 = (rows: unknown[]) => ({
    content: rows,
    pagination: {
      page: 0,
      size: 12,
      totalElements: rows.length,
      totalPages: 1,
      first: true,
      last: true,
    },
  });
  await page.route("**/admin-api/resources/users**", (route) =>
    route.fulfill({ json: page1([admin, suspended]) }),
  );
  let reactivated = false;
  await page.route(`**/admin-api/social/users/${suspended.id}**`, (route) => {
    const url = route.request().url();
    if (url.endsWith("/reactivate")) {
      reactivated = true;
      return route.fulfill({ json: { cancelled: 1 } });
    }
    if (url.includes("/bans"))
      return route.fulfill({
        json: page1([
          {
            id: "b1",
            reason: "Spam",
            status: "ACTIVE",
            banType: "TEMPORAL",
            expiresAt: suspended.ban.expiresAt,
          },
        ]),
      });
    if (url.includes("/posts")) return route.fulfill({ json: page1([]) });
    return route.fulfill({
      json: {
        ...suspended,
        bannerUrl:
          "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
        profilePictureUrl:
          "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
      },
    });
  });
  await page.goto("/#comunidad");
  const row = page.getByRole("row").filter({ hasText: "@explorador" });
  await expect(row.getByText(/quedan 1 d|quedan 2 d/)).toBeVisible();
  await row.getByRole("button", { name: "Ver perfil" }).click();
  const dialog = page.getByRole("dialog", { name: "Perfil de @explorador" });
  await expect(dialog.getByAltText("Banner del perfil")).toBeVisible();
  await expect(dialog.getByAltText("Foto de perfil")).toBeVisible();
  await expect(
    dialog.getByText("Cuenta suspendida temporalmente"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/perfil-usuario.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Quitar suspensión" }).click();
  await page.getByRole("button", { name: "Confirmar cambio" }).click();
  await expect.poll(() => reactivated).toBe(true);
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

test("consulta revisiones reales del contrato", async ({ page }) => {
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
        // Formato real de ObservationListResponse en el backend.
        pagination: {
          page: 0,
          size: 12,
          totalElements: 1,
          totalPages: 1,
          first: true,
          last: true,
        },
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Solicitudes de revisión" }).click();
  await expect(
    page.getByText("Roble de prueba", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1 registros", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Ver", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("98 %");
  await page.screenshot({
    path: "test-results/observacion-actualizada.png",
    fullPage: true,
  });
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
  await dialog.getByLabel(/^Tipo de zona/).selectOption("GREEN_ZONE");
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
    type: "GREEN_ZONE",
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
          author: { id: "u1", username: "explorador" },
          images: [],
          createdAt: "2026-11-15T11:00:00Z",
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
  await page.getByRole("button", { name: "Revisar", exact: true }).click();
  // La denuncia muestra la publicación denunciada tal como en la app.
  await expect(
    page.getByText("Contenido reportado", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Contenido denunciado").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Marcar en revisión", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Marcar la denuncia en revisión" })
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Marcar la denuncia en revisión" }),
  ).toHaveCount(0);
  expect(writes).toEqual(["/admin-api/social/reports/r1/status"]);
  await page.screenshot({
    path: "test-results/denuncia-revision.png",
    fullPage: true,
  });
  // Sancionar bloquea el contenido y marca la denuncia como revisada.
  writes.length = 0;
  await page.getByRole("button", { name: "Bloquear", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect
    .poll(() => writes)
    .toEqual([
      "/admin-api/social/posts/p1/toggle-banned",
      "/admin-api/social/reports/r1/status",
    ]);
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

test("logros publicados, creación y estado de despliegue", async ({ page }) => {
  await mock(page);
  await page.goto("/#gamificacion");
  await page.getByRole("tab", { name: "Logros" }).click();
  await expect(
    page.getByText(/El servicio de logros no está disponible/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nuevo logro", exact: true }),
  ).toBeDisabled();
  let payload: Record<string, unknown> | null = null;
  await page.route("**/admin-api/achievements", async (route) => {
    if (route.request().method() === "POST") {
      payload = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { id: "logro-test", ...payload },
      });
    }
    return route.fulfill({
      json: payload ? [{ id: "logro-test", ...payload, active: true }] : [],
    });
  });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo logro", exact: true }).click();
  await page.getByLabel("Identificador único").fill("primera-planta");
  await page.getByLabel("Nombre", { exact: true }).fill("Mi primera planta");
  await page
    .getByLabel("Descripción", { exact: true })
    .fill("Registra tu primera observación");
  // Constructor de bloques: observaciones O publicaciones, y un bloque NO.
  const builder = page.locator(".predicate-builder");
  await builder.getByRole("button", { name: "Regla", exact: true }).click();
  await builder.getByLabel("Actividad").nth(1).selectOption("posts");
  await builder.getByLabel("Cantidad").nth(1).fill("2");
  await builder.getByRole("button", { name: "Se cumple alguna (O)" }).click();
  await builder.getByRole("button", { name: "Bloque", exact: true }).click();
  const inner = builder.locator(".pb-group .pb-group");
  await inner
    .locator(".pb-group-head")
    .getByRole("button", { name: "NO", exact: true })
    .click();
  await inner.getByLabel("Actividad").nth(1).selectOption("comments");
  await expect(builder.locator(".pb-summary")).toContainText(
    "al menos 1 observaciones o al menos 2 publicaciones o no (al menos 1 observaciones y al menos 1 comentarios)",
  );
  // Probar la condición con una cuenta real antes de guardar.
  let previewBody: Record<string, unknown> | null = null;
  await page.route("**/admin-api/resources/users?**", (route) =>
    route.fulfill({
      json: {
        content: [
          {
            id: "943e5eda-be65-40bc-b896-a4daad3f3d85",
            username: "laura",
            firstName: "Laura",
            lastName: "Gómez",
          },
        ],
        pagination: {
          page: 0,
          size: 5,
          totalElements: 1,
          totalPages: 1,
          first: true,
          last: true,
        },
      },
    }),
  );
  await page.route("**/admin-api/achievements/preview", (route) => {
    previewBody = route.request().postDataJSON();
    return route.fulfill({
      json: { satisfied: true, metricValues: { observations: 4, posts: 1 } },
    });
  });
  await builder.getByText("Probar con una cuenta").click();
  await builder.getByPlaceholder("Buscar usuario o correo").fill("lau");
  await builder.getByRole("button", { name: /@laura/ }).click();
  await expect(builder.locator(".pb-result")).toContainText(
    "@laura cumple la condición",
  );
  expect(previewBody).toMatchObject({
    userId: "943e5eda-be65-40bc-b896-a4daad3f3d85",
  });
  await page.screenshot({
    path: "test-results/logros-bloques.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Guardar en el servidor" }).click();
  await expect(
    page.getByRole("heading", { name: "Mi primera planta", exact: true }),
  ).toBeVisible();
  expect(payload).toMatchObject({
    xpReward: 10,
    predicate: {
      or: [
        { metric: "observations", op: "gte", value: 1 },
        { metric: "posts", op: "gte", value: 2 },
        {
          not: {
            and: [
              { metric: "observations", op: "gte", value: 1 },
              { metric: "comments", op: "gte", value: 1 },
            ],
          },
        },
      ],
    },
  });
  await page
    .getByRole("region", { name: "Logros del servidor" })
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  await expect(page.getByRole("switch", { name: "Activo" })).toBeChecked();
  await page.screenshot({
    path: "test-results/logros-editor.png",
    fullPage: true,
  });
});
