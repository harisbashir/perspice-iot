import { Inject, Injectable } from '@nestjs/common';
import { type Permission, canGrant } from '@perspice/shared';
import { asc, eq, ilike, or } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { conflict, forbidden, notFound, validation } from '../common/app-error';
import { CustomersService } from '../customers/customers.service';
import { DB } from '../db/db.module';
import { isUniqueViolation } from '../db/errors';
import { findOneOr404, scoped } from '../db/scoped-repo';
import { customer, user } from '../db/schema';
import { EmailService } from '../email/email.service';
import { RolesService } from '../rbac/roles.service';
import { type Scope, ScopeService } from '../rbac/scope';

type UserRow = typeof user.$inferSelect;

export interface UserDto {
  id: string;
  email: string;
  name: string;
  scopeType: 'platform' | 'customer';
  customerId: string | null;
  groupId: string | null;
  roleId: string;
  status: 'invited' | 'active' | 'disabled';
  totpEnabled: boolean;
  lastLogin: number | null;
  createdAt: number;
}

export const toUserDto = (u: UserRow): UserDto => ({
  id: u.id,
  email: u.email,
  name: u.name,
  scopeType: u.scopeType,
  customerId: u.customerId,
  groupId: u.groupId,
  roleId: u.roleId,
  status: u.status,
  totpEnabled: u.totpEnabled,
  lastLogin: u.lastLogin?.getTime() ?? null,
  createdAt: u.createdAt.getTime(),
});

export interface InviteInput {
  email: string;
  name: string;
  roleId: string;
  customerId?: string | null;
  groupId?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly scopes: ScopeService,
    private readonly roles: RolesService,
    private readonly customers: CustomersService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly email: EmailService,
  ) {}

  async list(actor: AuthUser, q: { search?: string; customerId?: string; scopeType?: 'platform' | 'customer' }) {
    const scope = await this.scopes.forUser(actor);
    const rows = await this.db
      .select()
      .from(user)
      .where(
        scoped(
          user,
          scope,
          q.search ? or(ilike(user.email, `%${q.search}%`), ilike(user.name, `%${q.search}%`)) : undefined,
          q.customerId ? eq(user.customerId, q.customerId) : undefined,
          q.scopeType ? eq(user.scopeType, q.scopeType) : undefined,
        ),
      )
      .orderBy(asc(user.email))
      .limit(1000);
    return rows.map(toUserDto);
  }

  async get(actor: AuthUser, id: string): Promise<UserDto> {
    return toUserDto(await this.find(actor, id));
  }

  async invite(actor: AuthUser, input: InviteInput): Promise<UserDto> {
    const scope = await this.scopes.forUser(actor);
    const targetRole = await this.roles.get(actor, input.roleId);
    await this.assertCanGrant(actor, targetRole.permissions);

    let customerId: string | null = null;
    let groupId: string | null = null;
    if (targetRole.scope === 'platform') {
      if (scope.kind !== 'platform') throw forbidden();
      if (input.customerId || input.groupId) {
        throw validation([{ path: ['customerId'], message: 'Platform roles cannot belong to a customer' }]);
      }
    } else {
      customerId = scope.kind === 'customer' ? scope.customerId : (input.customerId ?? null);
      if (scope.kind === 'customer' && input.customerId && input.customerId !== customerId) throw notFound();
      if (!customerId) throw validation([{ path: ['customerId'], message: 'Required for customer roles' }]);
      await this.customers.assertCustomerAccess(actor, customerId);
      if (targetRole.customerId && targetRole.customerId !== customerId) throw notFound();
      groupId = await this.resolveGroup(scope, customerId, input.groupId);
    }

    let created: UserRow;
    try {
      [created] = (await this.db
        .insert(user)
        .values({
          email: input.email.trim().toLowerCase(),
          name: input.name,
          scopeType: targetRole.scope,
          customerId,
          groupId,
          roleId: targetRole.id,
          status: 'invited',
        })
        .returning()) as [UserRow];
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A user with this email already exists');
      throw err;
    }
    await this.sendInvite(created, actor);
    return toUserDto(created);
  }

  async update(
    actor: AuthUser,
    id: string,
    patch: { name?: string; roleId?: string; status?: 'active' | 'disabled'; groupId?: string | null },
  ): Promise<UserDto> {
    const target = await this.find(actor, id);
    const changesAccess = patch.roleId !== undefined || patch.status !== undefined || patch.groupId !== undefined;
    if (changesAccess) {
      if (target.id === actor.id) throw forbidden('You cannot change your own role, status or group');
      await this.assertCanGrant(actor, (await this.roles.get(actor, target.roleId)).permissions);
    }
    const set: Partial<typeof user.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.roleId !== undefined) {
      const r = await this.roles.get(actor, patch.roleId);
      if (r.scope !== target.scopeType) throw validation([{ path: ['roleId'], message: 'Role scope does not match user' }]);
      if (r.customerId && r.customerId !== target.customerId) throw notFound();
      await this.assertCanGrant(actor, r.permissions);
      set.roleId = r.id;
    }
    if (patch.status !== undefined) {
      if (target.status === 'invited' && patch.status === 'active') {
        throw validation([{ path: ['status'], message: 'Invited users activate through their invite link' }]);
      }
      set.status = patch.status;
    }
    if (patch.groupId !== undefined) {
      if (target.scopeType !== 'customer') throw validation([{ path: ['groupId'], message: 'Only customer users have groups' }]);
      set.groupId = await this.resolveGroup(await this.scopes.forUser(actor), target.customerId!, patch.groupId);
    }
    const [row] = await this.db.update(user).set(set).where(eq(user.id, id)).returning();
    if (set.status === 'disabled' || set.roleId) await this.sessions.revokeAllForUser(id);
    return toUserDto(row!);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const target = await this.find(actor, id);
    if (target.id === actor.id) throw forbidden('You cannot delete yourself');
    await this.assertCanGrant(actor, (await this.roles.get(actor, target.roleId)).permissions);
    await this.sessions.revokeAllForUser(id);
    await this.db.delete(user).where(eq(user.id, id));
  }

  async resendInvite(actor: AuthUser, id: string): Promise<void> {
    const target = await this.find(actor, id);
    if (target.status !== 'invited') throw conflict('User has already activated their account');
    await this.sendInvite(target, actor);
  }

  private async find(actor: AuthUser, id: string): Promise<UserRow> {
    return findOneOr404(this.db, user, id, await this.scopes.forUser(actor));
  }

  private async assertCanGrant(actor: AuthUser, permissions: Permission[]): Promise<void> {
    if (!canGrant(actor.permissions, permissions)) throw forbidden('Cannot grant a role with more permissions than your own');
  }

  /** The group must belong to the customer and, for group-narrowed actors, to their subtree. */
  private async resolveGroup(scope: Scope, customerId: string, groupId: string | null | undefined): Promise<string | null> {
    if (!groupId) {
      if (scope.kind === 'customer' && scope.groupIds) {
        throw validation([{ path: ['groupId'], message: 'Choose one of your groups' }]);
      }
      return null;
    }
    await this.customers.getGroup(customerId, groupId);
    if (scope.kind === 'customer' && scope.groupIds && !scope.groupIds.includes(groupId)) throw notFound();
    return groupId;
  }

  private async sendInvite(target: UserRow, actor: AuthUser): Promise<void> {
    const token = await this.tokens.issue(target.id, 'invite');
    const slug = target.customerId
      ? ((await this.db.query.customer.findFirst({ where: eq(customer.id, target.customerId), columns: { slug: true } }))
          ?.slug ?? null)
      : null;
    await this.email.send(
      'user_invite',
      target.email,
      {
        name: target.name,
        inviterName: actor.name,
        link: `${this.auth.publicUrlFor(slug)}/activate?token=${token}`,
      },
      { customerId: target.customerId },
    );
  }
}

