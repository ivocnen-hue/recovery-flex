import { AuditRulesResponseSchema } from "../contracts/schemas";
import { BASE_URL, request } from "./client";

export const rulesApi = {
  list: (auditId: string) => request(`/api/v1/audits/${encodeURIComponent(auditId)}/rules`, AuditRulesResponseSchema),
  downloadDocument: async (downloadUrl: string) => {
    const response = await fetch(BASE_URL + downloadUrl, { credentials: "omit" });
    if (!response.ok) throw new Error("Não foi possível baixar o PDF da regra.");
    return response.blob();
  },
};
