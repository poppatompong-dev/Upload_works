import { openDatabase } from "../server/db.js";
import { exportGlobalManifest } from "../server/exporter.js";

openDatabase();
const result = await exportGlobalManifest();
console.log(JSON.stringify(result, null, 2));
