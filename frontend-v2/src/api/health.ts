import { WorkerHealthSchema } from "../contracts/schemas";
import { request } from "./client";

export const healthApi = {
  get: () => request("/api/v1/health", WorkerHealthSchema, { timeout: 10_000 }),
};
