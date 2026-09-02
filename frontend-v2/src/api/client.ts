import type { ZodType } from "zod";
import { ApiErrorSchema } from "../contracts/schemas";
import { RecoveryError } from "../lib/errors";
export const BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://recovery-audit-test.ivocnen.workers.dev"
).replace(/\/$/, "");
type RequestOptions = RequestInit & { timeout?: number };
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

const readApiError = (payload: unknown) => {
  const parsed = ApiErrorSchema.safeParse(payload);
  if (parsed.success) return parsed.data.error;

  // Error payloads must remain useful even when a newer Worker adds fields or
  // returns a partially compatible details object. Successful responses stay
  // strict; this fallback is intentionally limited to non-2xx responses.
  const error = asRecord(asRecord(payload)?.error);
  const details = asRecord(error?.details);
  return {
    code: typeof error?.code === "string" ? error.code : undefined,
    message: typeof error?.message === "string" ? error.message : undefined,
    details: {
      filename: typeof details?.filename === "string" ? details.filename : undefined,
      required_inputs: Array.isArray(details?.required_inputs)
        ? details.required_inputs
        : undefined,
      ambiguities: Array.isArray(details?.ambiguities)
        ? details.ambiguities
        : undefined,
    },
  };
};
export async function request<T>(
  endpoint: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeout ?? 30000,
  );
  let response: Response;
  try {
    response = await fetch(BASE_URL + endpoint, {
      ...options,
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RecoveryError(
        "NETWORK_ERROR",
        "O processamento excedeu o tempo de espera. Tente novamente com menos arquivos.",
        { endpoint, cause: "timeout" },
      );
    }
    throw new RecoveryError(
      "NETWORK_ERROR",
      "Não foi possível conectar ao Recovery. Verifique sua conexão.",
      { endpoint, cause: error instanceof Error ? error.name : "unknown" },
    );
  }
  clearTimeout(timeout);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new RecoveryError(
      "API_ERROR",
      "O servidor retornou uma resposta inválida.",
      { endpoint, http_status: response.status },
    );
  }
  if (!response.ok) {
    const apiError = readApiError(payload);
    const code =
      response.status === 401
        ? "AUTH_REQUIRED"
        : response.status === 403
          ? "PERMISSION_DENIED"
          : "API_ERROR";
    throw new RecoveryError(
      code,
      apiError.message || "A API não conseguiu concluir a solicitação.",
      {
        endpoint,
        http_status: response.status,
        api_code: apiError.code,
        required_inputs: apiError.details?.required_inputs,
        ambiguities: apiError.details?.ambiguities,
        filename: apiError.details?.filename,
      },
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const record =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    throw new RecoveryError(
      "SCHEMA_MISMATCH",
      "Resposta incompatível com a versão atual da API.",
      {
        endpoint,
        http_status: response.status,
        schema_version: record.schema_version,
        received_fields: Object.keys(record),
        validation: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      },
    );
  }
  return parsed.data;
}
export const notImplemented = (endpoint: string): never => {
  throw new RecoveryError(
    "NOT_IMPLEMENTED",
    "Esta integração aguarda o endpoint correspondente no Worker.",
    { endpoint },
  );
};
