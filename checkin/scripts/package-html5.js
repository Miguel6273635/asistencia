const fs = require("fs");
const path = require("path");
const bestzip = require("bestzip");

const projectRoot = path.resolve(__dirname, "..");
const distDirectory = path.join(projectRoot, "dist");
const archivePath = path.join(projectRoot, "checkin.zip");

if (!fs.existsSync(path.join(distDirectory, "manifest.json"))) {
  throw new Error("No se encontró dist/manifest.json. Ejecuta npm run build antes de empaquetar.");
}

fs.copyFileSync(
  path.join(projectRoot, "xs-app.json"),
  path.join(distDirectory, "xs-app.json")
);

bestzip({
  source: "*",
  destination: archivePath,
  cwd: distDirectory
}).then(function () {
  console.log("Paquete HTML5 generado con manifest.json y xs-app.json en la raíz:", archivePath);
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
