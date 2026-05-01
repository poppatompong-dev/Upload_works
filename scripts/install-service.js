import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Service } = require("node-windows");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const service = new Service({
  name: "NSM Practical Submission",
  description: "LAN exam submission server for PR assistant practical examination.",
  script: path.join(projectRoot, "server", "index.js"),
  workingDirectory: projectRoot,
  nodeOptions: ["--enable-source-maps"],
  env: [
    { name: "NODE_ENV", value: "production" },
    { name: "PORT", value: process.env.PORT || "8080" },
    { name: "HOST", value: process.env.HOST || "0.0.0.0" }
  ]
});

service.on("install", () => {
  console.log("Service installed. Starting...");
  service.start();
});
service.on("alreadyinstalled", () => {
  console.log("Service is already installed.");
});
service.on("start", () => {
  console.log("Service started.");
});
service.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

service.install();
