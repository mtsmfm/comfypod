import createClient from "openapi-fetch";
import type { paths, components } from "./runpod-api.js";
import { createSpinner } from "./spinner.js";

type RawPod = components["schemas"]["Pod"];
type RawNetworkVolume = components["schemas"]["NetworkVolume"];

export type Pod = Omit<RawPod, "id" | "env"> & {
  id: string;
  env?: Record<string, string>;
};

export type NetworkVolume = Omit<RawNetworkVolume, "id"> & {
  id: string;
};

export interface PodCreateInput {
  name: string;
  imageName: string;
  computeType?: "GPU" | "CPU";
  gpuTypeIds?: string[];
  gpuCount?: number;
  cpuFlavorIds?: string[];
  networkVolumeId?: string;
  volumeMountPath?: string;
  volumeInGb?: number;
  containerDiskInGb?: number;
  ports?: string[];
  env?: Record<string, string>;
  dockerStartCmd?: string[];
}

export class RunpodClient {
  private client: ReturnType<typeof createClient<paths>>;

  constructor(apiKey: string) {
    this.client = createClient<paths>({
      baseUrl: "https://rest.runpod.io/v1",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  }

  async createNetworkVolume(
    name: string,
    size: number,
    dataCenterId: string,
  ): Promise<NetworkVolume> {
    const { data, error } = await this.client.POST("/networkvolumes", {
      body: { name, size, dataCenterId },
    });
    if (error || !data || !data.id) {
      throw new Error(
        `Failed to create network volume: ${JSON.stringify(error)}`,
      );
    }
    return data as NetworkVolume;
  }

  async listNetworkVolumes(): Promise<NetworkVolume[]> {
    const { data, error } = await this.client.GET("/networkvolumes");
    if (error || !data) {
      throw new Error(
        `Failed to list network volumes: ${JSON.stringify(error)}`,
      );
    }
    return data.filter((v) => v.id) as NetworkVolume[];
  }

  async deleteNetworkVolume(id: string): Promise<void> {
    const { error } = await this.client.DELETE(
      "/networkvolumes/{networkVolumeId}",
      {
        params: { path: { networkVolumeId: id } },
      },
    );
    if (error) {
      throw new Error(
        `Failed to delete network volume: ${JSON.stringify(error)}`,
      );
    }
  }

  async tryDeleteNetworkVolume(id: string): Promise<boolean> {
    const { error, response } = await this.client.DELETE(
      "/networkvolumes/{networkVolumeId}",
      {
        params: { path: { networkVolumeId: id } },
      },
    );
    if (response.status === 404) return false;
    if (error) {
      throw new Error(
        `Failed to delete network volume: ${JSON.stringify(error)}`,
      );
    }
    return true;
  }

  async updateNetworkVolume(
    id: string,
    input: { name?: string; size?: number },
  ): Promise<NetworkVolume> {
    const { data, error } = await this.client.PATCH(
      "/networkvolumes/{networkVolumeId}",
      {
        params: { path: { networkVolumeId: id } },
        body: input,
      },
    );
    if (error || !data || !data.id) {
      throw new Error(
        `Failed to update network volume: ${JSON.stringify(error)}`,
      );
    }
    return data as NetworkVolume;
  }

  async findNetworkVolumeByName(name: string): Promise<NetworkVolume | null> {
    const volumes = await this.listNetworkVolumes();
    return volumes.find((v) => v.name === name) || null;
  }

  async createPod(
    params: PodCreateInput,
    retryTimeoutMs = 1800000,
  ): Promise<Pod> {
    const retryIntervalMs = 30000;
    const start = Date.now();
    let spinner: ReturnType<typeof createSpinner> | undefined;

    for (;;) {
      const { data, error, response } = await this.client.POST("/pods", {
        body: params as components["schemas"]["PodCreateInput"],
      });

      if (data?.id) {
        spinner?.stop("Pod created");
        return data as Pod;
      }

      const errorMessage = JSON.stringify(error);

      if (
        response.status === 401 ||
        response.status === 403 ||
        Date.now() - start >= retryTimeoutMs
      ) {
        spinner?.stop(`Failed: ${errorMessage}`);
        throw new Error(`Failed to create pod: ${errorMessage}`);
      }

      if (!spinner) {
        spinner = createSpinner(
          `Create pod failed: ${errorMessage}, retrying...`,
        );
      } else {
        spinner.update(`Create pod failed: ${errorMessage}, retrying...`);
      }
      await new Promise((r) => setTimeout(r, retryIntervalMs));
    }
  }

  async listPods(): Promise<Pod[]> {
    const { data, error } = await this.client.GET("/pods");
    if (error || !data) {
      throw new Error(`Failed to list pods: ${JSON.stringify(error)}`);
    }
    return data.filter((p) => p.id) as Pod[];
  }

  async getPod(id: string): Promise<Pod> {
    const { data, error } = await this.client.GET("/pods/{podId}", {
      params: { path: { podId: id } },
    });
    if (error || !data || !data.id) {
      throw new Error(`Failed to get pod: ${JSON.stringify(error)}`);
    }
    return data as Pod;
  }

  async tryGetPod(id: string): Promise<Pod | null> {
    const { data, response } = await this.client.GET("/pods/{podId}", {
      params: { path: { podId: id } },
    });
    if (response.status === 404) return null;
    if (!data || !data.id) return null;
    return data as Pod;
  }

  async stopPod(id: string): Promise<void> {
    const { error } = await this.client.POST("/pods/{podId}/stop", {
      params: { path: { podId: id } },
    });
    if (error) {
      throw new Error(`Failed to stop pod: ${JSON.stringify(error)}`);
    }
  }

  async deletePod(id: string): Promise<void> {
    const { error } = await this.client.DELETE("/pods/{podId}", {
      params: { path: { podId: id } },
    });
    if (error) {
      throw new Error(`Failed to delete pod: ${JSON.stringify(error)}`);
    }
  }

  async tryDeletePod(id: string): Promise<boolean> {
    const { error, response } = await this.client.DELETE("/pods/{podId}", {
      params: { path: { podId: id } },
    });
    if (response.status === 404) return false;
    if (error) {
      throw new Error(`Failed to delete pod: ${JSON.stringify(error)}`);
    }
    return true;
  }

  async findPodByName(name: string): Promise<Pod | null> {
    const pods = await this.listPods();
    return pods.find((p) => p.name === name) || null;
  }
}
