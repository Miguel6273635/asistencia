const fs = require("fs");
const path = require("path");
const bestzip = require("bestzip");

const projectRoot = path.resolve(__dirname, "..");
const distDirectory = path.join(projectRoot, "dist");
const archivePath = path.join(projectRoot, "monitor-asistencia.zip");
const manifestPath = path.join(distDirectory, "manifest.json");
const sourceXsAppPath = path.join(projectRoot, "xs-app.json");
const targetXsAppPath = path.join(distDirectory, "xs-app.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error(
    "No se encontró dist/manifest.json. Ejecuta npm run build antes de empaquetar."
  );
}

if (!fs.existsSync(sourceXsAppPath)) {
  throw new Error(
    "No se encontró xs-app.json en la raíz del proyecto."
  );
}

fs.copyFileSync(sourceXsAppPath, targetXsAppPath);

bestzip({
  source: "*",
  destination: archivePath,
  cwd: distDirectory
})
  .then(function () {
    console.log("Paquete HTML5 generado:", archivePath);
  })
  .catch(function (error) {
    console.error("No fue posible generar monitor-asistencia.zip:", error);
    process.exit(1);
  });