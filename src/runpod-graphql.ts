import type { DataCenterId, GpuTypeId } from "./runpod-gpu-types.js";

export interface PodFindAndDeployOnDemandInput {
  name?: string;
  imageName?: string;
  gpuTypeId?: GpuTypeId;
  gpuCount?: number;
  cloudType?: "ALL" | "COMMUNITY" | "SECURE";
  volumeInGb?: number;
  containerDiskInGb?: number;
  minVcpuCount?: number;
  minMemoryInGb?: number;
  dockerArgs?: string;
  ports?: string;
  volumeMountPath?: string;
  env?: { key: string; value: string }[];
  startSsh?: boolean;
  templateId?: string;
  networkVolumeId?: string;
  allowedCudaVersions?: string[];
  supportPublicIp?: boolean;
  dataCenterId?: DataCenterId;
  countryCode?: string;
}

export class GraphQLUnauthorizedError extends Error {}

const GRAPHQL_URL = "https://api.runpod.io/graphql";

const CREATE_POD_MUTATION = `mutation ComfypodCreatePod($input: PodFindAndDeployOnDemandInput!) {
  podFindAndDeployOnDemand(input: $input) {
    id
  }
}`;

export async function podFindAndDeployOnDemand(
  apiKey: string,
  input: PodFindAndDeployOnDemandInput,
): Promise<{ id: string }> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: CREATE_POD_MUTATION,
      variables: { input },
    }),
  });
  const json = (await res.json()) as {
    data?: { podFindAndDeployOnDemand: { id: string } | null };
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    const message = json.errors.map((e) => e.message).join("; ");
    if (/unauthor/i.test(message) || /forbid/i.test(message)) {
      throw new GraphQLUnauthorizedError(message);
    }
    throw new Error(message);
  }
  const pod = json.data?.podFindAndDeployOnDemand;
  if (!pod?.id) {
    throw new Error(
      `podFindAndDeployOnDemand returned no pod: ${JSON.stringify(json)}`,
    );
  }
  return { id: pod.id };
}
