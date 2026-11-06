// const fs = require("fs");
// const path = require("path");

// const projectRoot = path.resolve(__dirname, "..");
// const packagePath = path.join(projectRoot, "package.json");
// const manifestPath = path.join(projectRoot, "webapp", "manifest.json");
// const mtaPath = path.join(projectRoot, "mta.yaml");

// const packageJson = JSON.parse(
//   fs.readFileSync(packagePath, "utf8")
// );

// const manifest = JSON.parse(
//   fs.readFileSync(manifestPath, "utf8")
// );

// const version = String(packageJson.version || "").trim();

// if (!/^\d+\.\d+\.\d+$/.test(version)) {
//   throw new Error(
//     "La versión de package.json no es válida: " + version
//   );
// }

// manifest["sap.app"] = manifest["sap.app"] || {};
// manifest["sap.app"].applicationVersion =
//   manifest["sap.app"].applicationVersion || {};

// manifest["sap.app"].applicationVersion.version = version;

// fs.writeFileSync(
//   manifestPath,
//   JSON.stringify(manifest, null, 2) + "\n",
//   "utf8"
// );

// const mtaSource = fs.readFileSync(mtaPath, "utf8");
// const mtaVersionMatch = /^version:\s*([^\s]+)\s*$/m.exec(mtaSource);
// const mtaVersion = mtaVersionMatch ? mtaVersionMatch[1] : "";

// if (mtaVersion !== version) {
//   throw new Error(
//     "Las versiones no coinciden: " +
//       "package.json=" + version +
//       ", mta.yaml=" + mtaVersion +
//       ". Actualiza mta.yaml antes de generar el MTAR."
//   );
// }

// console.log(
//   "Versión sincronizada: " +
//     "package.json=" + version +
//     ", manifest.json=" + version +
//     ", mta.yaml=" + mtaVersion
// );

const fs = require("fs");
const path = require("path");

// Carpeta desde donde se ejecuta npm (raíz del monitor o carpeta checkin)
const projectRoot = process.cwd();
const packagePath = path.join(projectRoot, "package.json");
const manifestPath = path.join(projectRoot, "webapp", "manifest.json");
const mtaPath = path.join(projectRoot, "mta.yaml");

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const version = String(packageJson.version || "").trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("La versión de package.json no es válida: " + version);
}

manifest["sap.app"] = manifest["sap.app"] || {};
manifest["sap.app"].applicationVersion = manifest["sap.app"].applicationVersion || {};
manifest["sap.app"].applicationVersion.version = version;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

let mtaVersion = "(sin mta.yaml)";
if (fs.existsSync(mtaPath)) {
  const mtaSource = fs.readFileSync(mtaPath, "utf8");
  const mtaVersionMatch = /^version:\s*([^\s]+)\s*$/m.exec(mtaSource);
  mtaVersion = mtaVersionMatch ? mtaVersionMatch[1] : "";

  if (mtaVersion !== version) {
    throw new Error(
      "Las versiones no coinciden: " +
        "package.json=" + version +
        ", mta.yaml=" + mtaVersion +
        ". Actualiza mta.yaml antes de generar el MTAR."
    );
  }
} else {
  console.warn("[sync-version] No hay mta.yaml en " + projectRoot + "; se omite la validación.");
}

console.log(
  "Versión sincronizada en " + path.basename(projectRoot) + ": " +
    "package.json=" + version +
    ", manifest.json=" + version +
    ", mta.yaml=" + mtaVersion
);