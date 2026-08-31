export type ErrorCode =
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "SCHEMA_MISMATCH"
  | "NOT_IMPLEMENTED"
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED";
export class RecoveryError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public debug?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RecoveryError";
  }
}
export const humanError = (error: unknown) =>
  error instanceof RecoveryError
    ? error.message
    : "Não foi possível concluir esta ação. Tente novamente.";
