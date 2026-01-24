import { defineConfig } from "comfypod";

export default defineConfig({
  dataCenterId: "EU-CZ-1",
  gpu: {
    typeIds: ["NVIDIA GeForce RTX 3090"],
  },
  models: [
    {
      url: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
      dest: "checkpoints/sd_xl_base_1.0.safetensors",
    },
  ],
});
