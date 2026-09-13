/** A user as returned by the backend auth endpoints. */
export interface AuthUser {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
}

export interface LoginCredentials {
  identifier: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface LogoutResponse {
  success: boolean;
  message: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  type: string;
  membership_status: string;
  role_name: string;
}

export interface MeResponse {
  user: AuthUser;
  organizations: OrganizationSummary[];
}
