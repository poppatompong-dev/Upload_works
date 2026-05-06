import { archiveAllCandidateVideos } from "../server/exporter.js";

try {
  const result = await archiveAllCandidateVideos();
  console.log(
    JSON.stringify(
      {
        ok: true,
        videoArchiveRoot: result.videoArchiveRoot,
        originalDir: result.originalDir,
        mp4Dir: result.mp4Dir,
        candidates: result.candidates,
        files: result.files
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
