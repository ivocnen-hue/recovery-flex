export const queryKeys = {
  health: () => ["worker-health"] as const,
  audits: (filters = "all") => ["audits", filters] as const,
  audit: (id: string) => ["audit", id] as const,
  findings: (id: string, filters = "all") => ["findings", id, filters] as const,
  evidence: (id: string) => ["evidence", id] as const,
};
