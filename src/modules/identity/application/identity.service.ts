import type { PoolClient } from "pg";

export type UserRole = "PATIENT" | "DOCTOR" | "ADMIN" | "SUPPORT";

export interface UserRow {
  id: string;
  auth_user_id: string;
  email: string;
  role: UserRole;
  mfa_enabled: boolean;
  mfa_required: boolean;
}

export class MfaRequiredError extends Error {
  constructor(role: UserRole) {
    super(`MFA é obrigatório para o papel ${role} e não está habilitado para este usuário`);
    this.name = "MfaRequiredError";
  }
}

/**
 * `authUserId` é o espelho do Supabase Auth (auth.users.id) — único e
 * imutável. Nenhum outro registro pode reutilizá-lo (constraint UNIQUE no
 * banco), e o serviço nunca o atualiza após a criação.
 */
export class IdentityService {
  async createUser(
    client: PoolClient,
    input: { authUserId: string; email: string; role: UserRole; mfaEnabled?: boolean }
  ): Promise<UserRow> {
    const mfaRequired = input.role === "DOCTOR" || input.role === "ADMIN";
    const { rows } = await client.query<UserRow>(
      `INSERT INTO users (auth_user_id, email, role, mfa_enabled, mfa_required)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.authUserId, input.email, input.role, input.mfaEnabled ?? false, mfaRequired]
    );
    return rows[0];
  }

  async getByAuthUserId(client: PoolClient, authUserId: string): Promise<UserRow | null> {
    const { rows } = await client.query<UserRow>(`SELECT * FROM users WHERE auth_user_id = $1`, [authUserId]);
    return rows[0] ?? null;
  }

  /** Verifica o requisito de MFA no login — chamado pela camada de auth antes de emitir sessão. */
  assertLoginAllowed(user: UserRow): void {
    if (user.mfa_required && !user.mfa_enabled) {
      throw new MfaRequiredError(user.role);
    }
  }
}

export const identityService = new IdentityService();
