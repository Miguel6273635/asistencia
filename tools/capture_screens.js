"use strict";

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const outputDir = path.resolve(__dirname, "../documentacion/capturas");
const baseUrl = "http://127.0.0.1:8082/index.html";

const screens = [
  { file: "01-resumen-por-zona.png", hash: "#", title: "Resumen por zona" },
  { file: "02-centros-de-trabajo.png", hash: "#/centers/all", title: "Centros de trabajo" },
  { file: "03-detalle-centro.png", hash: "#/center/tlalnepantla", title: "Centro de trabajo" },
  { file: "04-registros-asistencia.png", hash: "#/records/all", title: "Registros de asistencia" },
  { file: "05-turnos-horarios.png", hash: "#/shifts", title: "Turnos y horarios" },
  { file: "06-usuarios.png", hash: "#/users", title: "Administración de usuarios" },
  { file: "07-desempeno-usuario.png", hash: "#/user-performance/emp-1001", title: "Desempeño" },
  { file: "08-mapa-general.png", hash: "#/map", title: "Mapa" },
  { file: "09-mapa-zona.png", hash: "#/map/norte", title: "Mapa" },
  { file: "10-mapa-usuario.png", hash: "#/map/oeste/emp-1001", title: "Mapa" },
  { file: "10-configuracion.png", hash: "#/settings", title: "Configuración" }
];

async function waitForScreen(page, expectedTitle) {
  await page.waitForLoadState("networkidle", { timeout: 120000 });
  await page.waitForFunction(
    (text) => document.body && document.body.innerText.includes(text),
    expectedTitle,
    { timeout: 120000 }
  );
  await page.waitForTimeout(3500);
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath
  });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  });

  for (const screen of screens) {
    const url = `${baseUrl}${screen.hash}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForScreen(page, screen.title);
    await page.screenshot({
      path: path.join(outputDir, screen.file),
      fullPage: true,
      animations: "disabled"
    });
    console.log(`${screen.file}\t${await page.title()}\t${url}`);
  }

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
