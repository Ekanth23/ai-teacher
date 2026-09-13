/**
 * Backend base URL from environment configuration.
 *
 * VITE_API_BASE_URL is provided in development via `.env` (see `.env.example`).
 * When empty or unset, requests are made to the same origin (e.g. when the
 * frontend is served behind the backend or a reverse proxy).
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);
