import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const OPENAPI_URL = "https://rest.runpod.io/v1/openapi.json";
const OPENAPI_PATH = "src/openapi.json";
const OUTPUT_PATH = "src/runpod-api.ts";

// Fetch OpenAPI schema
const res = await fetch(OPENAPI_URL);
const schema = (await res.json()) as {
  paths: Record<string, { post?: { operationId?: string } }>;
};

// Fix duplicate operationIds
// RunPod's API has PATCH and POST synonyms with the same operationId for /update paths
for (const [path, methods] of Object.entries(schema.paths)) {
  if (path.endsWith("/update") && methods.post?.operationId) {
    methods.post.operationId += "ViaPost";
  }
}

writeFileSync(OPENAPI_PATH, JSON.stringify(schema));

// Generate TypeScript types and format
execSync(`npx openapi-typescript ${OPENAPI_PATH} -o ${OUTPUT_PATH}`, {
  stdio: "inherit",
});
execSync(`npx prettier --write ${OUTPUT_PATH} ${OPENAPI_PATH}`, {
  stdio: "inherit",
});
