const fs = require("node:fs");
const path = require("node:path");

const [mode, root, commit] = process.argv.slice(2);
const ua = path.join(root, ".ua");
const intermediate = path.join(ua, "intermediate");
const scan = JSON.parse(
  fs.readFileSync(path.join(intermediate, "scan-result.json"), "utf8"),
);

if (mode === "prepare") {
  fs.copyFileSync(
    path.join(intermediate, "assembled-graph.json"),
    path.join(ua, "knowledge-graph.json"),
  );
  fs.writeFileSync(
    path.join(intermediate, "fingerprint-input.json"),
    `${JSON.stringify(
      {
        projectRoot: root,
        filePaths: scan.files.map((file) => file.path),
        gitCommitHash: commit,
      },
      null,
      2,
    )}\n`,
  );
} else if (mode === "meta") {
  fs.writeFileSync(
    path.join(ua, "meta.json"),
    `${JSON.stringify(
      {
        lastAnalyzedAt: new Date().toISOString(),
        gitCommitHash: commit,
        version: "1.0.0",
        analyzedFiles: scan.files.length,
      },
      null,
      2,
    )}\n`,
  );
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
