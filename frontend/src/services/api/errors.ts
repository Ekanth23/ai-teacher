/**
 * Normalized API error. Never exposes backend stack traces — only the
 * human-readable code/message returned by the API (or a safe generic message).
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}
