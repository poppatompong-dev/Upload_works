import { clearTestData } from "../server/reset.js";

if (process.env.NODE_ENV === "production" && process.env.EXAM_ENABLE_DEV_RESET !== "1") {
  throw new Error("clear:test-data script is disabled in production unless EXAM_ENABLE_DEV_RESET=1");
}

const result = await clearTestData({ actor: "system:clear-test-data-script" });

console.log("Cleared test upload data");
console.log(`Files removed from database: ${result.before.files}`);
console.log(`Submission rows reset: ${result.before.submissions}`);
console.log("Cleared folders:");
for (const item of result.clearedDirs) {
  console.log(`- ${item.name}: ${item.path}`);
}
console.log(`Preserved: ${result.preserved.join(", ")}`);
