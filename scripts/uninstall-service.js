import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Service } = require("node-windows");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const service = new Service({
  name: "NSM Practical Submission",
  script: path.join(projectRoot, "server", "index.js")
});

service.on("uninstall", () => {
  console.log("Service uninstalled.");
});
service.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

service.uninstall();
