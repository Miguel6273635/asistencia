const fs = require("fs");
const path = require("path");
const bestzip = require("bestzip");

const projectRoot = path.resolve(__dirname, "..");
const distDirectory = process.env.UI5_BUILD_DIR
  ? path.resolve(process.env.UI5_BUILD_DIR)
  : path.join(projectRoot, "dist");
const archivePath = process.env.HTML5_ARCHIVE_PATH
  ? path.resolve(process.env.HTML5_ARCHIVE_PATH)
  : path.join(projectRoot, "monitor-asistencia.zip");
const manifestPath = path.join(distDirectory, "manifest.json");
const sourceXsAppPath = path.join(projectRoot, "xs-app.json");
const targetXsAppPath = path.join(distDirectory, "xs-app.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error(
    `No se encontró ${manifestPath}. Ejecuta npm run build antes de empaquetar.`
  );
}

if (!fs.existsSync(sourceXsAppPath)) {
  throw new Error("No se encontró xs-app.json en la raíz del proyecto.");
}

fs.copyFileSync(sourceXsAppPath, targetXsAppPath);

bestzip({
  source: "*",
  destination: archivePath,
  cwd: distDirectory
}).then(function () {
  console.log("Paquete HTML5 generado:", archivePath);
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
