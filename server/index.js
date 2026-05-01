import Fastify from "fastify";
import { config, paths } from "./config.js";
import { ensureDir } from "./fs-utils.js";
import { openDatabase, logAudit } from "./db.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info"
  },
  bodyLimit: 8 * 1024 * 1024
});

async function bootstrap() {
  await Promise.all([
    ensureDir(paths.submissionsDir),
    ensureDir(paths.tempDir),
    ensureDir(paths.exportsDir),
    ensureDir(paths.logsDir),
    ensureDir(paths.backupSubmissionsDir),
    ensureDir(paths.backupExportsDir),
    ensureDir(paths.uploadWorksRosterDir),
    ensureDir(paths.uploadWorksAssetsDir)
  ]);
  openDatabase();
  await registerRoutes(app);
  await app.listen({ port: config.port, host: config.host });
  logAudit("system", "server_started", {
    port: config.port,
    host: config.host,
    dataRoot: config.dataRoot,
    backupRoot: config.backupRoot
  });
}

bootstrap().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
