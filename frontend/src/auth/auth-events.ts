/**
 * Lightweight event channel between the API client (which has no access to React
 * context) and AuthProvider. When a definitive authentication failure occurs
 * (e.g. an access token is invalid and its refresh also failed), the client
 * clears storage and emits this event; AuthProvider listens and transitions the
 * app to the unauthenticated state.
 */
export const AUTH_UNAUTHORIZED_EVENT = "ai-teacher:auth:unauthorized";

export function emitUnauthorized(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }
}
