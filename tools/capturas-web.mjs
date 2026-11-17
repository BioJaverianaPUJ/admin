// Toma capturas de todas las secciones del panel web de BioJaveriana.
// Uso: doble clic en Capturas\capturar-web.bat (o `node tools/capturas-web.mjs`
// con `npm run dev` corriendo). Solo abre pantallas y diálogos: no guarda nada.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const base = process.env.BIO_URL ?? "http://localhost:5173/";
const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "Capturas",
  "web",
);

function ask(question, hidden = false) {
  return new Promise((done) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else rl.output.write("*");
      };
    }
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      done(a.trim());
    });
  });
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No responde ${base}. ¿Está corriendo "npm run dev"?`);
}

await mkdir(join(out, "sdd"), { recursive: true });
await waitForServer();
const email = process.env.BIO_EMAIL || (await ask("Correo de administrador: "));
const password = process.env.BIO_PASSWORD || (await ask("Contraseña: ", true));

let browser;
try {
  browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : undefined,
    executablePath: process.env.BIO_BROWSER || undefined,
    args: process.platform === "win32" ? [] : ["--no-sandbox"],
  });
} catch {
  browser = await chromium.launch({ channel: "chrome" });
}
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: "es-CO",
});
if (process.env.BIO_CAPTURA_MOCK)
  await (await import(process.env.BIO_CAPTURA_MOCK)).default(context);
const page = await context.newPage();
page.setDefaultTimeout(8000);
const done = [],
  skipped = [];

const pause = (ms = 1200) => page.waitForTimeout(ms);
// Código de cada captura en el SDD (sección 3.4): se guarda una copia con ese nombre.
const codes = {
  "01-login": "W01",
  "02-catalogo-especies": "W02",
  "05-catalogo-especimenes": "W03",
  "07-catalogo-solicitudes-revision": "W04",
  "03-catalogo-nueva-especie": "W05",
  "04-catalogo-detalle-especie": "W06",
  "08-zonas-puntos-de-interes": "W07",
  "09-zonas-nuevo-punto-de-interes": "W09",
  "10-zonas-vista-3d": "W10",
  "11-zonas-verdes-nuevo-borrador": "W11",
  "14-gamificacion-misiones": "W12",
  "15-gamificacion-nueva-mision": "W13",
  "18-comunidad-usuarios": "W14",
  "19-comunidad-perfil-de-usuario": "W16",
  "19b-comunidad-suspender": "W17",
  "20-comunidad-publicaciones": "W18",
  "21-comunidad-denuncias": "W19",
  "21b-comunidad-contenido-denunciado": "W20",
};
async function shot(name, full = true) {
  await pause(700);
  if (name !== "01-login" && !(await page.locator(".app-shell").count()))
    throw new Error("la pantalla quedó en blanco");
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: full });
  for (const code of [
    codes[name],
    name === "18-comunidad-usuarios" ? "W15" : null,
  ].filter(Boolean))
    await page.screenshot({
      path: join(out, "sdd", `${code}.png`),
      fullPage: false,
    });
  done.push(name);
  console.log(`  ✓ ${name}.png`);
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    skipped.push(name);
    console.log(
      `  – ${name}: no se pudo (${String(e.message).split("\n")[0]})`,
    );
  }
}
async function closeModal() {
  await page.keyboard.press("Escape");
  await pause(300);
  const close = page.locator("dialog[open] header button[aria-label='Cerrar']");
  if (await close.count()) await close.first().click();
  await pause(300);
}
const button = (name) => page.getByRole("button", { name, exact: true });
async function section(hash) {
  // Recarga completa: si una pantalla anterior falló, la app vuelve a quedar limpia.
  await page.goto(base + "#" + hash);
  await page.reload();
  await page.locator(".app-shell").waitFor({ timeout: 20000 });
  await pause(2500);
}

console.log(`\nGuardando capturas en: ${out}\n`);

// --- Acceso ---
await page.goto(base);
await pause(1500);
await step("01-login", () => shot("01-login", false));
await page.getByLabel("Correo electrónico").fill(email);
await page.getByLabel("Contraseña *", { exact: true }).fill(password);
await button("Entrar al módulo").click();
try {
  await page.locator(".app-shell").waitFor({ timeout: 20000 });
} catch {
  await shot("00-error-de-acceso", false);
  console.log("\nNo se pudo iniciar sesión. Revisa el correo y la contraseña.");
  await browser.close();
  process.exit(1);
}

// --- Catálogo ---
await section("catalogo");
await step("02-catalogo-especies", () => shot("02-catalogo-especies"));
await step("03-catalogo-nueva-especie", async () => {
  await button("Nueva especie").click();
  await shot("03-catalogo-nueva-especie", false);
  await closeModal();
});
await step("04-catalogo-detalle-especie", async () => {
  await page.locator("table button[aria-label^='Ver ']").first().click();
  await shot("04-catalogo-detalle-especie", false);
  await closeModal();
});
await step("05-catalogo-especimenes", async () => {
  await page
    .getByRole("button", { name: /Especímenes/ })
    .first()
    .click();
  await pause();
  await shot("05-catalogo-especimenes");
});
await step("06-catalogo-detalle-especimen", async () => {
  await page.locator("table button[aria-label^='Ver ']").first().click();
  await shot("06-catalogo-detalle-especimen", false);
  await closeModal();
});
await step("07-catalogo-solicitudes-revision", async () => {
  await page.getByRole("button", { name: /Solicitudes de revisión/ }).click();
  await pause();
  await shot("07-catalogo-solicitudes-revision");
});

// --- Zonas ---
await section("zonas");
await step("08-zonas-puntos-de-interes", () =>
  shot("08-zonas-puntos-de-interes"),
);
await step("08b-zonas-panel-puntos", async () => {
  const panel = page.locator("section.data-panel").first();
  await panel.screenshot({ path: join(out, "sdd", "W08.png") });
});
await step("09-zonas-nuevo-punto-de-interes", async () => {
  await page.getByRole("button", { name: /Crear punto de interés/ }).click();
  await pause(2000);
  await shot("09-zonas-nuevo-punto-de-interes", false);
  await closeModal();
});
await step("10-zonas-vista-3d", async () => {
  await page.getByRole("button", { name: /Abrir vista 3D/ }).click();
  await pause(6000);
  const panel = page.locator(".campus-3d-panel");
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: join(out, "10-zonas-vista-3d.png") });
  await panel.screenshot({ path: join(out, "sdd", "W10.png") });
  done.push("10-zonas-vista-3d");
  console.log("  ✓ 10-zonas-vista-3d.png");
  await page.getByRole("button", { name: /Ocultar vista 3D/ }).click();
});
await step("11-zonas-verdes-nuevo-borrador", async () => {
  await button("Nuevo borrador").click();
  await pause(1500);
  await shot("11-zonas-verdes-nuevo-borrador", false);
  await closeModal();
});
await step("12-zonas-de-interes", async () => {
  await page.getByRole("button", { name: /Zonas de interés/ }).click();
  await pause();
  await shot("12-zonas-de-interes");
});
await step("13-zonas-limite-del-campus", async () => {
  await page.getByRole("button", { name: /Límite del campus/ }).click();
  await pause(2500);
  await shot("13-zonas-limite-del-campus");
});

// --- Gamificación ---
await section("gamificacion");
await step("14-gamificacion-misiones", () => shot("14-gamificacion-misiones"));
await step("15-gamificacion-nueva-mision", async () => {
  await button("Nuevo borrador").click();
  await shot("15-gamificacion-nueva-mision", false);
  await closeModal();
});
await step("16-gamificacion-logros", async () => {
  await page.getByRole("button", { name: /^Logros/ }).click();
  await pause();
  await shot("16-gamificacion-logros");
});
await step("17-gamificacion-datos-curiosos", async () => {
  await page.getByRole("button", { name: /Datos curiosos/ }).click();
  await pause();
  await shot("17-gamificacion-datos-curiosos");
});

// --- Comunidad ---
await section("comunidad");
await step("18-comunidad-usuarios", () => shot("18-comunidad-usuarios"));
await step("19-comunidad-perfil-de-usuario", async () => {
  await button("Ver perfil").first().click();
  await shot("19-comunidad-perfil-de-usuario", false);
  await closeModal();
});
await step("19b-comunidad-suspender", async () => {
  await button("Suspender").first().click();
  await shot("19b-comunidad-suspender", false);
  await closeModal();
});
await step("20-comunidad-publicaciones", async () => {
  await button("Publicaciones").click();
  await pause(1800);
  await shot("20-comunidad-publicaciones");
});
await step("21-comunidad-denuncias", async () => {
  await button("Denuncias").click();
  await pause(1800);
  await shot("21-comunidad-denuncias");
});
await step("21b-comunidad-contenido-denunciado", async () => {
  await button("Consultar").first().click();
  await pause(1200);
  await shot("21b-comunidad-contenido-denunciado", false);
  await closeModal();
});

// --- Vista en celular ---
await page.setViewportSize({ width: 390, height: 844 });
await section("catalogo");
await step("22-celular-catalogo", () => shot("22-celular-catalogo"));
await step("23-celular-menu", async () => {
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await shot("23-celular-menu", false);
});

await browser.close();
console.log(`\nListo: ${done.length} capturas en ${out}`);
if (skipped.length)
  console.log(
    `No se pudieron tomar (normalmente porque no hay datos): ${skipped.join(", ")}`,
  );
