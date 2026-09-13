/**
 * Shape of the backend's standardized error envelope:
 *
 *   { "error": { "code": "...", "message": "..." } }
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/** A discriminated success/error envelope for future typed responses. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number } };
