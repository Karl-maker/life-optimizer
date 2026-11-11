const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const ua = path.join(root, ".ua");
const intermediate = path.join(ua, "intermediate");
const graph = JSON.parse(
  fs.readFileSync(path.join(intermediate, "assembled-graph.json"), "utf8"),
);
const scan = JSON.parse(
  fs.readFileSync(path.join(intermediate, "scan-result.json"), "utf8"),
);
const layers = JSON.parse(
  fs.readFileSync(path.join(intermediate, "layers.json"), "utf8"),
);
const tour = JSON.parse(
  fs.readFileSync(path.join(intermediate, "tour.json"), "utf8"),
);
const commit = process.argv[3];
const nodeIds = new Set(graph.nodes.map((node) => node.id));

const issues = [];
for (const layer of layers) {
  for (const field of ["id", "name", "description", "nodeIds"])
    if (layer[field] === undefined) issues.push(`Layer missing ${field}`);
  for (const id of layer.nodeIds ?? [])
    if (!nodeIds.has(id)) issues.push(`Layer ${layer.id} references ${id}`);
}
for (const [index, step] of tour.entries()) {
  for (const field of ["order", "title", "description", "nodeIds"])
    if (step[field] === undefined)
      issues.push(`Tour ${index} missing ${field}`);
  for (const id of step.nodeIds ?? [])
    if (!nodeIds.has(id)) issues.push(`Tour ${index} references ${id}`);
}
for (const [index, edge] of graph.edges.entries()) {
  if (!nodeIds.has(edge.source)) issues.push(`Edge ${index} source missing`);
  if (!nodeIds.has(edge.target)) issues.push(`Edge ${index} target missing`);
}

const finalGraph = {
  version: "1.0.0",
  project: {
    name: scan.name,
    languages: scan.languages,
    frameworks: scan.frameworks,
    description: scan.description,
    analyzedAt: new Date().toISOString(),
    gitCommitHash: commit,
  },
  nodes: graph.nodes,
  edges: graph.edges,
  layers,
  tour,
};
fs.writeFileSync(
  path.join(intermediate, "assembled-graph.json"),
  `${JSON.stringify(finalGraph, null, 2)}\n`,
);

const edgeNodes = new Set(
  graph.edges.flatMap((edge) => [edge.source, edge.target]),
);
const warnings = graph.nodes
  .filter((node) => !edgeNodes.has(node.id))
  .map((node) => `Node '${node.id}' has no edges (orphan)`);
const stats = {
  totalNodes: graph.nodes.length,
  totalEdges: graph.edges.length,
  totalLayers: layers.length,
  tourSteps: tour.length,
  nodeTypes: Object.groupBy(graph.nodes, (node) => node.type),
  edgeTypes: Object.groupBy(graph.edges, (edge) => edge.type),
};
for (const key of ["nodeTypes", "edgeTypes"])
  stats[key] = Object.fromEntries(
    Object.entries(stats[key]).map(([name, values]) => [name, values.length]),
  );
fs.writeFileSync(
  path.join(intermediate, "review.json"),
  `${JSON.stringify({ issues, warnings, stats }, null, 2)}\n`,
);
if (issues.length) process.exitCode = 1;
