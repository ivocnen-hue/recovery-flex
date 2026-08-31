import { FindingsResponseSchema } from "../contracts/schemas";
import { request } from "./client";
export const findingsApi = {
  list: (auditId: string, query = "") =>
    request(
      "/api/v1/audits/" + encodeURIComponent(auditId) + "/findings" + query,
      FindingsResponseSchema,
    ),
};
