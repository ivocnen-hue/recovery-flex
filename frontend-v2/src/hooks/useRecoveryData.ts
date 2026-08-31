import { useQuery } from "@tanstack/react-query";
import { auditsApi } from "../api/audits";
import { findingsApi } from "../api/findings";
import { queryKeys } from "../api/queryKeys";
import { demoAudit, demoAudits, demoFindings } from "../mocks/demoData";
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== "false";
export const useAuditSummary = () =>
  useQuery({
    queryKey: queryKeys.audit("latest"),
    queryFn: async () => (DEMO_MODE ? demoAudit : auditsApi.get("latest")),
    retry: false,
  });
export const useAudits = () =>
  useQuery({
    queryKey: queryKeys.audits(),
    queryFn: async () =>
      DEMO_MODE
        ? {
            ok: true as const,
            schema_version: "1.0" as const,
            items: demoAudits,
            next_cursor: null,
          }
        : auditsApi.list(),
    retry: false,
  });
export const useFindings = () =>
  useQuery({
    queryKey: queryKeys.findings("latest"),
    queryFn: async () =>
      DEMO_MODE
        ? {
            ok: true as const,
            schema_version: "1.0" as const,
            audit_id: "audit_demo_024",
            items: demoFindings,
            next_cursor: null,
          }
        : findingsApi.list("latest"),
    retry: false,
  });
