/** Panel users (staff) and roles — pure types. */

export type StaffState = "active" | "invited" | "suspended";

export const STAFF_STATES: Record<StaffState, { label: string; tone: "green" | "amber" | "slate" }> = {
  active: { label: "Aktif", tone: "green" },
  invited: { label: "Davet bekliyor", tone: "amber" },
  suspended: { label: "Askıda", tone: "slate" },
};

export interface RoleRef {
  id: string;
  name: string;
}

export interface StaffSummary {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  department: string | null;
  jobTitle: string | null;
  roles: RoleRef[];
  state: StaffState;
  lastLoginAt: string | null;
  invitedAt: string | null;
  createdAt: string;
}

export interface StaffSession {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface StaffDetail extends StaffSummary {
  invitedByName: string | null;
  passwordChangedAt: string | null;
  failedAttempts: number;
  /** Expiry of the open invitation (state "invited"). */
  inviteExpiresAt: string | null;
  sessions: StaffSession[];
  permissions: string[];
}

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  updatedAt: string;
}

export interface StaffInput {
  email: string;
  displayName: string;
  phone?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  roleIds: string[];
}

export type StaffPatch = Partial<Omit<StaffInput, "email">>;

export interface RoleInput {
  name: string;
  description?: string | null;
  permissions: string[];
}

/** One-time link handed to the admin (no e-mail provider yet). */
export interface DeliveredLink {
  path: string;
  expiresAt: string;
}
