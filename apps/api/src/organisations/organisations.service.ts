import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID, randomBytes } from 'crypto';
import { Organisation } from './organisation.entity';
import { Membership, MemberRole, MemberStatus } from './membership.entity';
import { OrgInvite } from './org-invite.entity';
import { Proposal } from '../proposals/proposal.entity';
import { Vote } from '../votes/vote.entity';
import { User } from '../users/user.entity';
import { Topic } from '../topics/topic.entity';
import { Delegation } from '../delegations/delegation.entity';
import { DelegationsService } from '../delegations/delegations.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { WebhooksService } from '../webhooks/webhooks.service';

type OrgType = 'company' | 'cooperative' | 'community' | 'dao' | 'nonprofit' | 'other';

function defaultFeaturesForType(type: OrgType | null | undefined) {
  const all = { delegation: true, advanced_voting: true, argumentation: true, proposal_queue: true, sentiment: true };
  const presets: Record<OrgType, typeof all> = {
    company:     { delegation: false, advanced_voting: false, argumentation: true,  proposal_queue: false, sentiment: true  },
    cooperative: { delegation: true,  advanced_voting: false, argumentation: true,  proposal_queue: false, sentiment: true  },
    community:   { delegation: false, advanced_voting: false, argumentation: false, proposal_queue: false, sentiment: false },
    dao:         { delegation: true,  advanced_voting: true,  argumentation: true,  proposal_queue: true,  sentiment: true  },
    nonprofit:   { delegation: false, advanced_voting: false, argumentation: true,  proposal_queue: false, sentiment: false },
    other:       all,
  };
  return type ? (presets[type] ?? all) : all;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class OrganisationsService {
  constructor(
    @InjectRepository(Organisation)
    private readonly orgRepo: Repository<Organisation>,
    @InjectRepository(Membership)
    private readonly memberRepo: Repository<Membership>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(OrgInvite)
    private readonly inviteRepo: Repository<OrgInvite>,
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly webhooks: WebhooksService,
  ) {}

  async findAll(): Promise<Organisation[]> {
    return this.orgRepo.find({ order: { created_at: 'ASC' } });
  }

  async getStats(): Promise<{ orgs: number; members: number; votes: number }> {
    const [orgs, members, votes] = await Promise.all([
      this.orgRepo.count(),
      this.memberRepo.count({ where: { status: 'approved' as MemberStatus } }),
      this.dataSource.getRepository(Vote).count(),
    ]);
    return { orgs, members, votes };
  }

  async findBySlug(slug: string): Promise<Organisation> {
    const org = await this.orgRepo.findOneBy({ slug });
    if (!org) throw new NotFoundException(`Organisation "${slug}" not found`);
    return org;
  }

  async getAdminSettings(slug: string, userId: string): Promise<{ invite_token: string | null; discord_webhook_url: string | null; scim_enabled: boolean }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, userId, ['admin']);
    return {
      invite_token: org.invite_token,
      discord_webhook_url: org.discord_webhook_url,
      scim_enabled: !!org.scim_token,
    };
  }

  async findForUser(userId: string): Promise<Organisation[]> {
    const memberships = await this.memberRepo.find({ where: { user_id: userId, status: 'approved' as MemberStatus } });
    if (memberships.length === 0) return [];
    const orgIds = memberships.map((m) => m.organisation_id);
    return this.orgRepo
      .createQueryBuilder('o')
      .where('o.id IN (:...ids)', { ids: orgIds })
      .orderBy('o.created_at', 'ASC')
      .getMany();
  }

  async create(
    data: { name: string; slug?: string; description?: string; org_type?: string; features?: Record<string, boolean> },
    creatorId: string,
  ): Promise<{ item: Organisation; txid: number }> {
    const slug = data.slug ? toSlug(data.slug) : toSlug(data.name);
    if (!slug) throw new BadRequestException('Invalid organisation name or slug');
    const existing = await this.orgRepo.findOneBy({ slug });
    if (existing) throw new ConflictException(`Slug "${slug}" is already taken`);

    return this.dataSource.transaction(async (manager) => {
      const org = manager.create(Organisation, {
        id: randomUUID(),
        name: data.name.trim(),
        slug,
        description: data.description?.trim() ?? '',
        org_type: data.org_type ?? null,
        features: data.features ?? defaultFeaturesForType(data.org_type as OrgType | null),
      });
      const saved = await manager.save(org);

      const membership = manager.create(Membership, {
        id: randomUUID(),
        organisation_id: saved.id,
        user_id: creatorId,
        role: 'admin',
        unsubscribe_token: randomBytes(24).toString('hex'),
      });
      await manager.save(membership);

      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item: saved, txid: parseInt(row.txid, 10) };
    });
  }

  async update(
    slug: string,
    data: Partial<Pick<Organisation, 'name' | 'description' | 'proposal_creation_role' | 'topic_creation_role' | 'default_voting_duration_days' | 'default_threshold' | 'voting_visibility' | 'default_quorum' | 'is_public' | 'veto_role' | 'min_endorsements' | 'require_member_approval' | 'proposal_templates' | 'allowed_email_domains' | 'primary_color' | 'logo_url' | 'data_retention_months' | 'discord_webhook_url' | 'quadratic_credits' | 'credit_period_days' | 'email_from_name' | 'email_from_address' | 'boost_threshold' | 'oidc_issuer' | 'oidc_client_id' | 'oidc_client_secret' | 'sso_required' | 'org_type' | 'features'>>,
    userId: string,
  ): Promise<{ item: Organisation; txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, userId, ['admin']);

    const result = await this.dataSource.transaction(async (manager) => {
      const updates: Partial<Organisation> = {};
      if (data.name !== undefined) updates.name = data.name.trim();
      if (data.description !== undefined) updates.description = data.description;
      if (data.proposal_creation_role !== undefined) updates.proposal_creation_role = data.proposal_creation_role;
      if (data.topic_creation_role !== undefined) updates.topic_creation_role = data.topic_creation_role;
      if (data.default_voting_duration_days !== undefined) updates.default_voting_duration_days = data.default_voting_duration_days;
      if (data.default_threshold !== undefined) updates.default_threshold = data.default_threshold;
      if (data.voting_visibility !== undefined) updates.voting_visibility = data.voting_visibility;
      if (data.default_quorum !== undefined) updates.default_quorum = data.default_quorum;
      if (data.is_public !== undefined) updates.is_public = data.is_public;
      if (data.veto_role !== undefined) updates.veto_role = data.veto_role;
      if (data.min_endorsements !== undefined) updates.min_endorsements = data.min_endorsements;
      if (data.require_member_approval !== undefined) updates.require_member_approval = data.require_member_approval;
      if (data.proposal_templates !== undefined) updates.proposal_templates = data.proposal_templates;
      if (data.allowed_email_domains !== undefined) updates.allowed_email_domains = data.allowed_email_domains;
      if (data.primary_color !== undefined) updates.primary_color = data.primary_color;
      if (data.logo_url !== undefined) updates.logo_url = data.logo_url;
      if (data.data_retention_months !== undefined) updates.data_retention_months = data.data_retention_months;
      if (data.discord_webhook_url !== undefined) updates.discord_webhook_url = data.discord_webhook_url;
      if (data.quadratic_credits !== undefined) updates.quadratic_credits = data.quadratic_credits;
      if (data.credit_period_days !== undefined) updates.credit_period_days = data.credit_period_days;
      if (data.email_from_name !== undefined) updates.email_from_name = data.email_from_name;
      if (data.email_from_address !== undefined) updates.email_from_address = data.email_from_address;
      if (data.boost_threshold !== undefined) updates.boost_threshold = data.boost_threshold;
      if (data.oidc_issuer !== undefined) updates.oidc_issuer = data.oidc_issuer;
      if (data.oidc_client_id !== undefined) updates.oidc_client_id = data.oidc_client_id;
      if (data.oidc_client_secret !== undefined) updates.oidc_client_secret = data.oidc_client_secret;
      if (data.sso_required !== undefined) updates.sso_required = data.sso_required;
      if (data.org_type !== undefined) updates.org_type = data.org_type;
      if (data.features !== undefined) updates.features = data.features;
      await manager.update(Organisation, org.id, updates);
      const item = await manager.findOneByOrFail(Organisation, { id: org.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
    this.auditLog.log(org.id, userId, 'org.settings_changed', 'org', org.id, data as Record<string, unknown>);
    return result;
  }

  async applyNonprofit(
    slug: string,
    actorId: string,
    data: { nonprofit_name: string; nonprofit_registration_number?: string; nonprofit_country?: string },
  ): Promise<{ item: Organisation; txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    if (!data.nonprofit_name.trim()) throw new BadRequestException('Organisation name is required');
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Organisation, org.id, {
        plan: 'nonprofit',
        nonprofit_name: data.nonprofit_name.trim(),
        nonprofit_registration_number: data.nonprofit_registration_number?.trim() ?? null,
        nonprofit_country: data.nonprofit_country?.trim() ?? null,
      });
      const item = await manager.findOneByOrFail(Organisation, { id: org.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
  }

  async delete(slug: string, userId: string): Promise<{ txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, userId, ['admin']);

    return this.dataSource.transaction(async (manager) => {
      await manager.delete(Organisation, org.id);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
  }

  // --- Membership ---

  async listMembers(orgId: string): Promise<Membership[]> {
    return this.memberRepo.find({
      where: { organisation_id: orgId },
      order: { joined_at: 'ASC' },
    });
  }

  async getMembership(orgId: string, userId: string): Promise<Membership | null> {
    return this.memberRepo.findOneBy({ organisation_id: orgId, user_id: userId });
  }

  async addMember(
    orgId: string,
    targetUserId: string,
    role: MemberRole,
    actorId: string,
  ): Promise<{ item: Membership; txid: number }> {
    await this.requireRole(orgId, actorId, ['admin', 'moderator']);
    if (role === 'admin') await this.requireRole(orgId, actorId, ['admin']);

    const existing = await this.memberRepo.findOneBy({ organisation_id: orgId, user_id: targetUserId });
    if (existing) throw new ConflictException('User is already a member');

    const result = await this.dataSource.transaction(async (manager) => {
      const membership = manager.create(Membership, {
        id: randomUUID(),
        organisation_id: orgId,
        user_id: targetUserId,
        role,
        invited_by: actorId,
        unsubscribe_token: randomBytes(24).toString('hex'),
      });
      const item = await manager.save(membership);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
    this.auditLog.log(orgId, actorId, 'member.added', 'user', targetUserId, { role });
    await this.notifyAdminsAndModerators(orgId, targetUserId, 'member.joined', targetUserId, orgId);
    this.webhooks.dispatch(orgId, 'member.joined', { user_id: targetUserId, role }).catch(() => {});
    return result;
  }

  async updateMemberRole(
    orgId: string,
    targetUserId: string,
    role: MemberRole,
    actorId: string,
  ): Promise<{ item: Membership; txid: number }> {
    await this.requireRole(orgId, actorId, ['admin']);
    const membership = await this.memberRepo.findOneBy({ organisation_id: orgId, user_id: targetUserId });
    if (!membership) throw new NotFoundException('Member not found');

    const prevRole = membership.role;
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.update(Membership, membership.id, { role });
      const item = await manager.findOneByOrFail(Membership, { id: membership.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
    this.auditLog.log(orgId, actorId, 'member.role_changed', 'user', targetUserId, { from: prevRole, to: role });
    return result;
  }

  async updateMemberWeight(
    orgId: string,
    targetUserId: string,
    weight: number,
    actorId: string,
  ): Promise<{ item: Membership; txid: number }> {
    await this.requireRole(orgId, actorId, ['admin']);
    if (weight < 1 || weight > 100 || !Number.isInteger(weight)) {
      throw new BadRequestException('Weight must be an integer between 1 and 100');
    }
    const membership = await this.memberRepo.findOneBy({ organisation_id: orgId, user_id: targetUserId });
    if (!membership) throw new NotFoundException('Member not found');

    const result = await this.dataSource.transaction(async (manager) => {
      await manager.update(Membership, membership.id, { weight });
      const item = await manager.findOneByOrFail(Membership, { id: membership.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
    this.auditLog.log(orgId, actorId, 'member.weight_changed', 'user', targetUserId, { weight });
    return result;
  }

  async removeMember(
    orgId: string,
    targetUserId: string,
    actorId: string,
  ): Promise<{ txid: number }> {
    if (targetUserId !== actorId) {
      await this.requireRole(orgId, actorId, ['admin']);
    }
    const membership = await this.memberRepo.findOneBy({ organisation_id: orgId, user_id: targetUserId });
    if (!membership) throw new NotFoundException('Member not found');

    // Prevent removing the last admin
    if (membership.role === 'admin') {
      const adminCount = await this.memberRepo.count({ where: { organisation_id: orgId, role: 'admin' } });
      if (adminCount <= 1) throw new ForbiddenException('Cannot remove the last admin');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      await manager.delete(Membership, membership.id);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
    this.auditLog.log(orgId, actorId, 'member.removed', 'user', targetUserId, { role: membership.role });
    return result;
  }

  // --- Invite token ---

  async generateInviteToken(slug: string, actorId: string): Promise<{ item: Organisation; txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    return this.dataSource.transaction(async (manager) => {
      const token = randomUUID();
      await manager.update(Organisation, org.id, { invite_token: token });
      const item = await manager.findOneByOrFail(Organisation, { id: org.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
  }

  async revokeInviteToken(slug: string, actorId: string): Promise<{ item: Organisation; txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Organisation, org.id, { invite_token: null });
      const item = await manager.findOneByOrFail(Organisation, { id: org.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
  }

  async generateScimToken(slug: string, actorId: string): Promise<{ token: string; item: Organisation; txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    const token = randomBytes(32).toString('hex');
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Organisation, org.id, { scim_token: token });
      const item = await manager.findOneByOrFail(Organisation, { id: org.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { token, item, txid: parseInt(row.txid, 10) };
    });
  }

  async revokeScimToken(slug: string, actorId: string): Promise<{ item: Organisation; txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Organisation, org.id, { scim_token: null });
      const item = await manager.findOneByOrFail(Organisation, { id: org.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
  }

  async setCustomDomain(slug: string, domain: string | null, actorId: string): Promise<{ item: Organisation; txid: number; verification_token?: string }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    const normalised = domain?.trim().toLowerCase() || null;
    if (normalised && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalised)) {
      throw new BadRequestException('Invalid domain format');
    }
    const verificationToken = normalised ? `ripple-verify=${org.id}` : null;
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Organisation, org.id, {
        custom_domain: normalised,
        custom_domain_verified: false,
        custom_domain_verified_at: null,
      });
      const item = await manager.findOneByOrFail(Organisation, { id: org.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10), ...(verificationToken ? { verification_token: verificationToken } : {}) };
    });
  }

  async verifyCustomDomain(slug: string, actorId: string): Promise<{ verified: boolean; message: string }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    if (!org.custom_domain) throw new BadRequestException('No custom domain configured');

    const expectedTxt = `ripple-verify=${org.id}`;
    try {
      const { promises: dns } = await import('dns');
      const records = await dns.resolveTxt(org.custom_domain);
      const flat = records.flat();
      const found = flat.some((r) => r === expectedTxt);
      if (found) {
        await this.orgRepo.update(org.id, { custom_domain_verified: true, custom_domain_verified_at: new Date() });
        return { verified: true, message: 'Domain verified successfully' };
      }
      return { verified: false, message: `TXT record "${expectedTxt}" not found for ${org.custom_domain}` };
    } catch (err) {
      return { verified: false, message: `DNS lookup failed: ${err instanceof Error ? err.message : 'unknown error'}` };
    }
  }

  private async checkEmailDomain(org: Organisation, userId: string): Promise<void> {
    if (!org.allowed_email_domains || org.allowed_email_domains.length === 0) return;
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new ForbiddenException('User not found');
    const domain = user.email.split('@')[1]?.toLowerCase();
    if (!org.allowed_email_domains.map((d) => d.toLowerCase()).includes(domain)) {
      throw new ForbiddenException(
        `Your email domain (@${domain}) is not allowed for this organisation. Allowed domains: ${org.allowed_email_domains.join(', ')}`,
      );
    }
  }

  async joinViaToken(slug: string, userId: string, token: string): Promise<{ item: Membership; txid: number }> {
    const org = await this.findBySlug(slug);
    if (!org.invite_token || org.invite_token !== token) {
      throw new ForbiddenException('Invalid or expired invite link');
    }
    await this.checkEmailDomain(org, userId);
    const existing = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: userId });
    if (existing) return { item: existing, txid: 0 };
    return this.dataSource.transaction(async (manager) => {
      const membership = manager.create(Membership, {
        id: randomUUID(),
        organisation_id: org.id,
        user_id: userId,
        role: 'member',
        unsubscribe_token: randomBytes(24).toString('hex'),
      });
      const item = await manager.save(membership);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
  }

  async joinPublic(slug: string, userId: string): Promise<{ item: Membership; txid: number }> {
    const org = await this.findBySlug(slug);
    if (!org.is_public) throw new ForbiddenException('This organisation is not open to the public');
    await this.checkEmailDomain(org, userId);
    const existing = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: userId });
    if (existing) return { item: existing, txid: 0 };
    const status: MemberStatus = org.require_member_approval ? 'pending' : 'approved';
    return this.dataSource.transaction(async (manager) => {
      const membership = manager.create(Membership, {
        id: randomUUID(),
        organisation_id: org.id,
        user_id: userId,
        role: 'member',
        invited_by: null,
        status,
        unsubscribe_token: randomBytes(24).toString('hex'),
      });
      const item = await manager.save(membership);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
  }

  async approveMember(slug: string, targetUserId: string, actorId: string): Promise<{ item: Membership; txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin', 'moderator']);
    const membership = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: targetUserId });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.status !== 'pending') throw new BadRequestException('Member is not pending approval');
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.update(Membership, membership.id, { status: 'approved' });
      const item = await manager.findOneByOrFail(Membership, { id: membership.id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
    this.auditLog.log(org.id, actorId, 'member.approved', 'user', targetUserId, {});
    await this.notifyAdminsAndModerators(org.id, targetUserId, 'member.joined', targetUserId, org.id);
    this.webhooks.dispatch(org.id, 'member.joined', { user_id: targetUserId, role: membership.role }).catch(() => {});
    return result;
  }

  async rejectMember(slug: string, targetUserId: string, actorId: string): Promise<{ txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin', 'moderator']);
    const membership = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: targetUserId });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.status !== 'pending') throw new BadRequestException('Member is not pending approval');
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.delete(Membership, membership.id);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
    this.auditLog.log(org.id, actorId, 'member.rejected', 'user', targetUserId, {});
    return result;
  }

  async transferOwnership(
    slug: string,
    toUserId: string,
    actorId: string,
  ): Promise<{ txid: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    if (toUserId === actorId) throw new BadRequestException('Cannot transfer ownership to yourself');
    const target = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: toUserId });
    if (!target) throw new NotFoundException('Target user is not a member of this organisation');

    return this.dataSource.transaction(async (manager) => {
      await manager.update(Membership, { organisation_id: org.id, user_id: toUserId }, { role: 'admin' });
      await manager.update(Membership, { organisation_id: org.id, user_id: actorId }, { role: 'member' });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
  }

  private async notifyAdminsAndModerators(
    orgId: string,
    excludeUserId: string,
    type: Parameters<NotificationsService['create']>[0]['type'],
    actorId: string,
    targetId: string,
  ): Promise<void> {
    try {
      const members = await this.memberRepo.find({ where: { organisation_id: orgId, status: 'approved' as MemberStatus } });
      const recipients = members
        .filter((m) => (m.role === 'admin' || m.role === 'moderator') && m.user_id !== excludeUserId)
        .map((m) => ({ userId: m.user_id, orgId, type, actorId, targetType: 'user', targetId }));
      await this.notifications.createMany(recipients);
    } catch { /* non-critical */ }
  }

  async requireMember(orgId: string, userId: string): Promise<Membership> {
    const m = await this.memberRepo.findOneBy({ organisation_id: orgId, user_id: userId, status: 'approved' as MemberStatus });
    if (!m) throw new ForbiddenException('You are not a member of this organisation');
    return m;
  }

  async requireRole(orgId: string, userId: string, roles: MemberRole[]): Promise<Membership> {
    const m = await this.requireMember(orgId, userId);
    if (!roles.includes(m.role)) {
      throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    }
    return m;
  }

  async searchMembers(slug: string, q: string): Promise<{ id: string; name: string }[]> {
    const org = await this.findBySlug(slug);
    const members = await this.memberRepo.find({ where: { organisation_id: org.id, status: 'approved' as MemberStatus } });
    const userIds = members.map((m) => m.user_id);
    if (userIds.length === 0) return [];
    const users = await this.userRepo
      .createQueryBuilder('u')
      .where('u.id IN (:...ids)', { ids: userIds })
      .andWhere('u.name ILIKE :q', { q: `${q.replace(/%/g, '\\%')}%` })
      .orderBy('u.name', 'ASC')
      .limit(10)
      .getMany();
    return users.map((u) => ({ id: u.id, name: u.name }));
  }

  async getMembersWithNames(orgId: string): Promise<{ userId: string; name: string }[]> {
    const members = await this.memberRepo.find({ where: { organisation_id: orgId, status: 'approved' as MemberStatus } });
    if (members.length === 0) return [];
    const userIds = members.map((m) => m.user_id);
    const users = await this.userRepo
      .createQueryBuilder('u')
      .where('u.id IN (:...ids)', { ids: userIds })
      .getMany();
    return users.map((u) => ({ userId: u.id, name: u.name }));
  }

  async getDelegationWeights(slug: string): Promise<Array<{ user_id: string; carried_weight: number }>> {
    const org = await this.findBySlug(slug);
    const memberships = await this.memberRepo.find({ where: { organisation_id: org.id, status: 'approved' as MemberStatus } });
    const ROLE_WEIGHT: Record<string, number> = { admin: 3, moderator: 2, member: 1, observer: 0 };
    const memberWeight = new Map<string, number>(memberships.map((m) => {
      const w = org.weight_mode === 'by_role' ? (ROLE_WEIGHT[m.role] ?? 1) : ((m as any).weight ?? 1);
      return [m.user_id, w];
    }));

    const allDelegations = await this.dataSource.getRepository(Delegation).find({ where: { organisation_id: org.id } });
    const active = DelegationsService.activeDelegations(allDelegations);

    const carriedWeight = new Map<string, number>(memberships.map((m) => [m.user_id, memberWeight.get(m.user_id) ?? 1]));
    for (const d of active) {
      const delegatorWeight = memberWeight.get(d.delegator_id) ?? 1;
      const current = carriedWeight.get(d.delegate_id) ?? 0;
      carriedWeight.set(d.delegate_id, current + delegatorWeight);
    }

    return [...carriedWeight.entries()].map(([user_id, carried_weight]) => ({ user_id, carried_weight }));
  }

  async getAnalytics(slug: string, actorId: string): Promise<{
    totalProposals: number;
    openProposals: number;
    closedProposals: number;
    totalVotes: number;
    totalMembers: number;
    participationRate: number;
    avgVotesPerProposal: number;
    proposalsByMonth: Array<{ month: string; count: number }>;
    topVoters: Array<{ user_id: string; name: string; voteCount: number }>;
    proposalOutcomes: { passed: number; failed: number; withdrawn: number };
    topicStats: Array<{ topic_id: string; topic_name: string; proposalCount: number; avgParticipation: number; passRate: number }>;
  }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin', 'moderator']);

    const [proposals, members, votes, topics] = await Promise.all([
      this.dataSource.getRepository(Proposal).find({ where: { organisation_id: org.id } }),
      this.memberRepo.find({ where: { organisation_id: org.id, status: 'approved' as any } }),
      this.dataSource.getRepository(Vote).find({ where: { organisation_id: org.id } }),
      this.dataSource.getRepository(Topic).find({ where: { organisation_id: org.id } }),
    ]);

    const totalProposals = proposals.length;
    const openProposals = proposals.filter((p) => p.status === 'open').length;
    const closedProposals = proposals.filter((p) => p.status === 'closed').length;
    const totalVotes = votes.length;
    const totalMembers = members.length;

    const closedWithVotes = proposals.filter((p) => p.status === 'closed' && p.proposal_type !== 'discussion');
    const votersPerProposal = closedWithVotes.map((p) =>
      new Set(votes.filter((v) => v.proposal_id === p.id).map((v) => v.user_id)).size,
    );
    const avgVotersPerProposal = votersPerProposal.length > 0
      ? votersPerProposal.reduce((a, b) => a + b, 0) / votersPerProposal.length
      : 0;
    const participationRate = totalMembers > 0 ? Math.round((avgVotersPerProposal / totalMembers) * 100) : 0;
    const avgVotesPerProposal = closedProposals > 0 ? Math.round(totalVotes / closedProposals) : 0;

    // Proposals by month (last 12 months)
    const now = new Date();
    const proposalsByMonth: Array<{ month: string; count: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const count = proposals.filter((p) => {
        const created = new Date(p.created_at);
        return created.getFullYear() === d.getFullYear() && created.getMonth() === d.getMonth();
      }).length;
      proposalsByMonth.push({ month: label, count });
    }

    // Top voters
    const votesByUser = new Map<string, number>();
    for (const v of votes) {
      votesByUser.set(v.user_id, (votesByUser.get(v.user_id) ?? 0) + 1);
    }
    const topUserIds = [...votesByUser.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
    const topUsers = topUserIds.length > 0
      ? await this.dataSource.getRepository(User).findBy(topUserIds.map((id) => ({ id })))
      : [];
    const topVoters = topUserIds.map((id) => ({
      user_id: id,
      name: topUsers.find((u) => u.id === id)?.name ?? 'Unknown',
      voteCount: votesByUser.get(id) ?? 0,
    }));

    const proposalOutcomes = {
      passed: proposals.filter((p) => p.outcome === 'implemented' || p.outcome === 'in_progress').length,
      failed: proposals.filter((p) => p.outcome === 'not_implemented').length,
      withdrawn: proposals.filter((p) => p.status === 'withdrawn').length,
    };

    // Topic-level stats
    const topicStats = topics.map((t) => {
      const topicProposals = proposals.filter((p) => p.topic_id === t.id && p.proposal_type !== 'discussion');
      const closedTopicProposals = topicProposals.filter((p) => p.status === 'closed');
      const votersPerP = closedTopicProposals.map((p) =>
        new Set(votes.filter((v) => v.proposal_id === p.id).map((v) => v.user_id)).size,
      );
      const avgParticipation = totalMembers > 0 && votersPerP.length > 0
        ? Math.round((votersPerP.reduce((a, b) => a + b, 0) / votersPerP.length / totalMembers) * 100)
        : 0;
      const passed = closedTopicProposals.filter((p) => {
        const yeses = votes.filter((v) => v.proposal_id === p.id && v.choice === 'yes').length;
        const nos = votes.filter((v) => v.proposal_id === p.id && v.choice === 'no').length;
        return yeses + nos > 0 && (yeses / (yeses + nos)) * 100 >= (p.threshold ?? 50);
      }).length;
      const passRate = closedTopicProposals.length > 0 ? Math.round((passed / closedTopicProposals.length) * 100) : 0;
      return {
        topic_id: t.id,
        topic_name: t.name,
        proposalCount: topicProposals.length,
        avgParticipation,
        passRate,
      };
    }).sort((a, b) => b.proposalCount - a.proposalCount);

    return {
      totalProposals,
      openProposals,
      closedProposals,
      totalVotes,
      totalMembers,
      participationRate,
      avgVotesPerProposal,
      proposalsByMonth,
      topVoters,
      proposalOutcomes,
      topicStats,
    };
  }

  async getPublicResults(slug: string): Promise<{ org: Organisation; proposals: Proposal[] }> {
    const org = await this.findBySlug(slug);
    if (!org.is_public) throw new ForbiddenException('This organisation does not have a public results page');
    const proposals = await this.dataSource.getRepository(Proposal).find({
      where: [
        { organisation_id: org.id, status: 'closed' as any },
        { organisation_id: org.id, status: 'withdrawn' as any },
      ],
      order: { closed_at: 'DESC', created_at: 'DESC' },
    });
    return { org, proposals };
  }

  async getDecisionRecord(slug: string, actorId: string, page = 1, pageSize = 25): Promise<{
    items: Array<{
      proposal: { id: string; title: string; proposal_type: string; topic_name: string; author_name: string | null; closed_at: string | null; threshold: number; outcome: string | null; status: string; anonymous_voting: boolean };
      tally: { yes: number; no: number; abstain: number } | null;
      result: 'passed' | 'failed' | 'no-votes' | 'withdrawn';
    }>;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin', 'moderator', 'member', 'observer']);

    const [proposals, total] = await this.dataSource.getRepository(Proposal).findAndCount({
      where: [
        { organisation_id: org.id, status: 'closed' as any },
        { organisation_id: org.id, status: 'withdrawn' as any },
      ],
      order: { closed_at: 'DESC', created_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    if (proposals.length === 0) return { items: [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) };

    const proposalIds = proposals.map((p) => p.id);
    const [votes, topics, users] = await Promise.all([
      this.dataSource.getRepository(Vote).find({ where: proposalIds.map((id) => ({ proposal_id: id })) }),
      this.dataSource.getRepository(Topic).find({ where: { organisation_id: org.id } }),
      this.dataSource.getRepository(User).find(),
    ]);

    const topicMap = new Map(topics.map((t) => [t.id, t.name]));
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    const items = proposals.map((p) => {
      const pVotes = votes.filter((v) => v.proposal_id === p.id);
      const yes = pVotes.filter((v) => v.choice === 'yes').length;
      const no = pVotes.filter((v) => v.choice === 'no').length;
      const abstain = pVotes.filter((v) => v.choice === 'abstain').length;
      const tally = p.anonymous_voting ? null : { yes, no, abstain };
      const nonAnonTally = { yes, no, abstain };

      let result: 'passed' | 'failed' | 'no-votes' | 'withdrawn';
      if (p.status === 'withdrawn') {
        result = 'withdrawn';
      } else if (nonAnonTally.yes + nonAnonTally.no === 0) {
        result = 'no-votes';
      } else {
        result = (nonAnonTally.yes / (nonAnonTally.yes + nonAnonTally.no)) * 100 >= (p.threshold ?? 50) ? 'passed' : 'failed';
      }

      return {
        proposal: {
          id: p.id,
          title: p.title,
          proposal_type: p.proposal_type,
          topic_name: topicMap.get(p.topic_id) ?? 'Unknown',
          author_name: p.author_id ? (userMap.get(p.author_id) ?? null) : null,
          closed_at: p.closed_at ? p.closed_at.toISOString() : null,
          threshold: p.threshold ?? 50,
          outcome: p.outcome ?? null,
          status: p.status,
          anonymous_voting: p.anonymous_voting,
        },
        tally,
        result,
      };
    });

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // Legacy non-paginated version kept for export
  async getDecisionRecordAll(slug: string, actorId: string): Promise<Array<{
    proposal: { id: string; title: string; proposal_type: string; topic_name: string; author_name: string | null; closed_at: string | null; threshold: number; outcome: string | null; status: string; anonymous_voting: boolean };
    tally: { yes: number; no: number; abstain: number } | null;
    result: 'passed' | 'failed' | 'no-votes' | 'withdrawn';
  }>> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin', 'moderator', 'member', 'observer']);

    const proposals = await this.dataSource.getRepository(Proposal).find({
      where: [
        { organisation_id: org.id, status: 'closed' as any },
        { organisation_id: org.id, status: 'withdrawn' as any },
      ],
      order: { closed_at: 'DESC', created_at: 'DESC' },
    });

    if (proposals.length === 0) return [];

    const proposalIds = proposals.map((p) => p.id);
    const [votes, topics, users] = await Promise.all([
      this.dataSource.getRepository(Vote).find({ where: proposalIds.map((id) => ({ proposal_id: id })) }),
      this.dataSource.getRepository(Topic).find({ where: { organisation_id: org.id } }),
      this.dataSource.getRepository(User).find(),
    ]);

    const topicMap = new Map(topics.map((t) => [t.id, t.name]));
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    return proposals.map((p) => {
      const pVotes = votes.filter((v) => v.proposal_id === p.id);
      const yes = pVotes.filter((v) => v.choice === 'yes').length;
      const no = pVotes.filter((v) => v.choice === 'no').length;
      const abstain = pVotes.filter((v) => v.choice === 'abstain').length;
      const tally = p.anonymous_voting ? null : { yes, no, abstain };
      const nonAnonTally = { yes, no, abstain };

      let result: 'passed' | 'failed' | 'no-votes' | 'withdrawn';
      if (p.status === 'withdrawn') {
        result = 'withdrawn';
      } else if (nonAnonTally.yes + nonAnonTally.no === 0) {
        result = 'no-votes';
      } else {
        result = (nonAnonTally.yes / (nonAnonTally.yes + nonAnonTally.no)) * 100 >= (p.threshold ?? 50) ? 'passed' : 'failed';
      }

      return {
        proposal: {
          id: p.id,
          title: p.title,
          proposal_type: p.proposal_type,
          topic_name: topicMap.get(p.topic_id) ?? 'Unknown',
          author_name: p.author_id ? (userMap.get(p.author_id) ?? null) : null,
          closed_at: p.closed_at ? p.closed_at.toISOString() : null,
          threshold: p.threshold ?? 50,
          outcome: p.outcome ?? null,
          status: p.status,
          anonymous_voting: p.anonymous_voting,
        },
        tally,
        result,
      };
    });
  }

  async inviteByEmail(slug: string, email: string, actorId: string): Promise<{ id: string }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin', 'moderator']);

    const normalised = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
      throw new BadRequestException('Invalid email address');
    }

    // Check if already a member
    const existingUser = await this.userRepo.findOneBy({ email: normalised });
    if (existingUser) {
      const existing = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: existingUser.id });
      if (existing) throw new ConflictException('This person is already a member');
    }

    // Check for pending unexpired invite
    const pending = await this.inviteRepo.findOne({
      where: { org_id: org.id, email: normalised, accepted_at: undefined as any },
    });
    if (pending && pending.accepted_at === null && pending.expires_at > new Date()) {
      throw new ConflictException('An invite has already been sent to this address');
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invite = await this.inviteRepo.save(
      this.inviteRepo.create({ id: randomUUID(), org_id: org.id, email: normalised, token, invited_by: actorId, expires_at: expires }),
    );

    const inviter = await this.userRepo.findOneBy({ id: actorId });
    const baseUrl = process.env.APP_URL ?? 'http://localhost:5173';
    this.email.sendInvite(normalised, inviter?.name ?? 'Someone', org.name, `${baseUrl}/accept-invite?token=${token}`)
      .catch(() => { /* non-critical */ });

    return { id: invite.id };
  }

  async listPendingInvites(slug: string, actorId: string): Promise<Array<{ id: string; email: string; created_at: Date; expires_at: Date; invited_by_name: string | null }>> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin', 'moderator']);

    const invites = await this.inviteRepo.find({
      where: { org_id: org.id },
      order: { created_at: 'DESC' },
    });
    const pending = invites.filter((i) => i.accepted_at === null && i.expires_at > new Date());

    const inviterIds = [...new Set(pending.map((i) => i.invited_by).filter(Boolean) as string[])];
    const inviters = inviterIds.length > 0
      ? await this.userRepo.findBy(inviterIds.map((id) => ({ id })))
      : [];
    const inviterMap = new Map(inviters.map((u) => [u.id, u.name]));

    return pending.map((i) => ({
      id: i.id,
      email: i.email,
      created_at: i.created_at,
      expires_at: i.expires_at,
      invited_by_name: i.invited_by ? (inviterMap.get(i.invited_by) ?? null) : null,
    }));
  }

  async cancelInvite(slug: string, inviteId: string, actorId: string): Promise<void> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin', 'moderator']);
    const invite = await this.inviteRepo.findOneBy({ id: inviteId, org_id: org.id });
    if (!invite) throw new NotFoundException('Invite not found');
    await this.inviteRepo.delete(inviteId);
  }

  async getInviteInfo(token: string): Promise<{ org: { id: string; name: string; description: string; slug: string }; email: string }> {
    const invite = await this.inviteRepo.findOneBy({ token });
    if (!invite || invite.accepted_at !== null || invite.expires_at < new Date()) {
      throw new NotFoundException('This invitation is invalid or has expired');
    }
    const org = await this.orgRepo.findOneBy({ id: invite.org_id });
    if (!org) throw new NotFoundException('Organisation not found');
    return { org: { id: org.id, name: org.name, description: org.description, slug: org.slug }, email: invite.email };
  }

  async acceptEmailInvite(token: string, userId: string): Promise<{ item: Membership; txid: number }> {
    const invite = await this.inviteRepo.findOneBy({ token });
    if (!invite || invite.accepted_at !== null || invite.expires_at < new Date()) {
      throw new BadRequestException('This invitation is invalid or has expired');
    }
    const user = await this.userRepo.findOneByOrFail({ id: userId });
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }
    const existing = await this.memberRepo.findOneBy({ organisation_id: invite.org_id, user_id: userId });
    if (existing) {
      await this.inviteRepo.update(invite.id, { accepted_at: new Date() });
      return { item: existing, txid: 0 };
    }

    return this.dataSource.transaction(async (manager) => {
      const membership = manager.create(Membership, {
        id: randomUUID(),
        organisation_id: invite.org_id,
        user_id: userId,
        role: 'member',
        unsubscribe_token: randomBytes(24).toString('hex'),
      });
      const saved = await manager.save(membership);
      await manager.update(OrgInvite, invite.id, { accepted_at: new Date() });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item: saved, txid: parseInt(row.txid, 10) };
    });
  }

  async updateEmailPreferences(slug: string, userId: string, prefs: { email_notifications_enabled?: boolean; email_digest_enabled?: boolean }): Promise<Membership> {
    const org = await this.findBySlug(slug);
    const membership = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: userId });
    if (!membership) throw new NotFoundException('You are not a member of this organisation');
    const update: Partial<Membership> = {};
    if (prefs.email_notifications_enabled !== undefined) update.email_notifications_enabled = prefs.email_notifications_enabled;
    if (prefs.email_digest_enabled !== undefined) update.email_digest_enabled = prefs.email_digest_enabled;
    await this.memberRepo.update(membership.id, update);
    return this.memberRepo.findOneByOrFail({ id: membership.id });
  }

  async getEmailPreferences(slug: string, userId: string): Promise<{ email_notifications_enabled: boolean; email_digest_enabled: boolean }> {
    const org = await this.findBySlug(slug);
    const membership = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: userId });
    if (!membership) throw new NotFoundException('You are not a member of this organisation');
    return { email_notifications_enabled: membership.email_notifications_enabled, email_digest_enabled: membership.email_digest_enabled };
  }

  async unsubscribeByToken(token: string): Promise<{ success: boolean; org_name: string }> {
    const membership = await this.memberRepo.findOne({ where: { unsubscribe_token: token } });
    if (!membership) throw new NotFoundException('Invalid unsubscribe link');
    await this.memberRepo.update(membership.id, { email_notifications_enabled: false, email_digest_enabled: false });
    const org = await this.orgRepo.findOneBy({ id: membership.organisation_id });
    return { success: true, org_name: org?.name ?? 'the organisation' };
  }

  async sendDigest(slug: string, actorId: string): Promise<{ sent: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

    // Open proposals
    const openProposals = await this.dataSource.query<{ id: string; title: string; closes_at: string | null }[]>(`
      SELECT p.id, p.title, p.closes_at
      FROM proposals p
      JOIN topics t ON t.id = p.topic_id
      WHERE t.organisation_id = $1 AND p.status = 'open'
      ORDER BY p.closes_at ASC NULLS LAST
      LIMIT 10
    `, [org.id]);

    // Recent results (closed in last 7 days)
    const recentResults = await this.dataSource.query<{ id: string; title: string; result: string }[]>(`
      SELECT p.id, p.title,
        CASE
          WHEN p.status = 'withdrawn' THEN 'withdrawn'
          WHEN NOT EXISTS (SELECT 1 FROM votes WHERE proposal_id = p.id) THEN 'no-votes'
          WHEN (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND choice = 'yes')::float /
               NULLIF((SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND choice IN ('yes','no')), 0) * 100 >= p.threshold
               THEN 'passed'
          ELSE 'failed'
        END AS result
      FROM proposals p
      JOIN topics t ON t.id = p.topic_id
      WHERE t.organisation_id = $1 AND p.status IN ('closed', 'withdrawn')
        AND p.closed_at > NOW() - INTERVAL '7 days'
      ORDER BY p.closed_at DESC
      LIMIT 10
    `, [org.id]);

    if (openProposals.length === 0 && recentResults.length === 0) return { sent: 0 };

    // Members who opted in
    const members = await this.dataSource.query<{ user_id: string; email: string; name: string; unsubscribe_token: string }[]>(`
      SELECT m.user_id, u.email, u.name, m.unsubscribe_token
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organisation_id = $1 AND m.status = 'approved'
        AND m.email_digest_enabled = TRUE AND m.email_notifications_enabled = TRUE
    `, [org.id]);

    let sent = 0;
    for (const member of members) {
      const unsubUrl = `${appUrl}/unsubscribe?token=${member.unsubscribe_token}`;
      await this.email.sendDigest(member.email, member.name, org.name, openProposals, recentResults, appUrl, slug, unsubUrl).catch(() => { /* non-critical */ });
      sent++;
    }
    return { sent };
  }

  async getCalendarIcs(slug: string, userId: string): Promise<string> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, userId, ['member', 'moderator', 'admin']);
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

    const proposals = await this.dataSource.query<Array<{
      id: string; title: string; closes_at: string | null; opens_at: string | null;
      created_at: string; status: string;
    }>>(
      `SELECT id, title, closes_at, opens_at, created_at, status
       FROM proposals
       WHERE organisation_id = $1
         AND status IN ('open', 'draft')
         AND (closes_at IS NOT NULL OR opens_at IS NOT NULL)
       ORDER BY COALESCE(closes_at, opens_at) ASC`,
      [org.id],
    );

    function icsDate(d: string): string {
      return new Date(d).toISOString().replace(/[-:]/g, '').replace('.000', '');
    }

    function icsText(s: string): string {
      return s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    }

    const events = proposals.flatMap((p) => {
      const lines: string[] = [];
      if (p.closes_at) {
        lines.push(
          'BEGIN:VEVENT',
          `UID:ripple-close-${p.id}@${slug}`,
          `DTSTAMP:${icsDate(p.created_at)}`,
          `DTSTART:${icsDate(p.closes_at)}`,
          `DTEND:${icsDate(p.closes_at)}`,
          `SUMMARY:${icsText(`Vote closes: ${p.title}`)}`,
          `URL:${appUrl}/orgs/${org.slug}/proposals/${p.id}`,
          'END:VEVENT',
        );
      }
      if (p.opens_at) {
        lines.push(
          'BEGIN:VEVENT',
          `UID:ripple-open-${p.id}@${slug}`,
          `DTSTAMP:${icsDate(p.created_at)}`,
          `DTSTART:${icsDate(p.opens_at)}`,
          `DTEND:${icsDate(p.opens_at)}`,
          `SUMMARY:${icsText(`Vote opens: ${p.title}`)}`,
          `URL:${appUrl}/orgs/${org.slug}/proposals/${p.id}`,
          'END:VEVENT',
        );
      }
      return lines;
    });

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//Ripple//${org.name}//EN`,
      `X-WR-CALNAME:${icsText(org.name)} proposals`,
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');
  }

  async exportDecisionRecordCsv(slug: string, actorId: string): Promise<string> {
    const records = await this.getDecisionRecordAll(slug, actorId);
    const headers = ['Title', 'Topic', 'Type', 'Status', 'Result', 'Closed Date', 'Yes', 'No', 'Abstain', 'Yes %', 'Threshold %', 'Implementation Status'];
    const rows = records.map(({ proposal, tally, result }) => {
      const yesCount = tally?.yes ?? '';
      const noCount = tally?.no ?? '';
      const abstainCount = tally?.abstain ?? '';
      const yesPct = tally && (tally.yes + tally.no) > 0
        ? Math.round((tally.yes / (tally.yes + tally.no)) * 100)
        : '';
      const closedDate = proposal.closed_at ? new Date(proposal.closed_at).toISOString().slice(0, 10) : '';
      return [
        `"${proposal.title.replace(/"/g, '""')}"`,
        `"${proposal.topic_name.replace(/"/g, '""')}"`,
        proposal.proposal_type,
        proposal.status,
        result,
        closedDate,
        yesCount,
        noCount,
        abstainCount,
        yesPct,
        proposal.threshold,
        proposal.outcome ?? '',
      ].join(',');
    });
    return [headers.join(','), ...rows].join('\n');
  }

  async exportOrgData(slug: string, actorId: string): Promise<object> {
    const org = await this.orgRepo.findOneByOrFail({ slug });
    await this.requireRole(org.id, actorId, ['admin']);

    const [memberships, topics, proposals, votes, delegations] = await Promise.all([
      this.memberRepo.find({ where: { organisation_id: org.id } }),
      this.dataSource.getRepository(Topic).find({ where: { organisation_id: org.id } }),
      this.dataSource.getRepository(Proposal).find({ where: { organisation_id: org.id } }),
      this.dataSource.getRepository(Vote).find({ where: { organisation_id: org.id } }),
      this.dataSource.getRepository(Delegation).find({ where: { organisation_id: org.id } }),
    ]);

    const userIds = [...new Set(memberships.map((m) => m.user_id))];
    const users = userIds.length > 0
      ? await this.dataSource.getRepository(User).findBy(userIds.map((id) => ({ id })))
      : [];

    return {
      exported_at: new Date().toISOString(),
      organisation: { id: org.id, name: org.name, slug: org.slug, created_at: org.created_at },
      members: memberships.map((m) => {
        const user = users.find((u) => u.id === m.user_id);
        return { user_id: m.user_id, name: user?.name, email: user?.email, role: m.role, status: m.status, joined_at: m.joined_at };
      }),
      topics: topics.map((t) => ({ id: t.id, name: t.name, description: t.description, created_at: t.created_at })),
      proposals: proposals.map((p) => ({
        id: p.id, title: p.title, status: p.status, proposal_type: p.proposal_type,
        author_id: p.author_id, topic_id: p.topic_id, threshold: p.threshold,
        created_at: p.created_at, closes_at: p.closes_at, closed_at: p.closed_at, outcome: p.outcome,
      })),
      votes: votes.map((v) => ({ id: v.id, proposal_id: v.proposal_id, user_id: v.user_id, choice: v.choice, created_at: v.created_at })),
      delegations: delegations.map((d) => ({ id: d.id, delegator_id: d.delegator_id, delegate_id: d.delegate_id, topic_id: d.topic_id, created_at: d.created_at, expires_at: d.expires_at })),
    };
  }

  async allocateCredits(slug: string, actorId: string): Promise<{ count: number }> {
    const org = await this.findBySlug(slug);
    await this.requireRole(org.id, actorId, ['admin']);
    if (!org.quadratic_credits) throw new BadRequestException('quadratic_credits not set for this org');
    const result = await this.dataSource.query(
      `UPDATE memberships SET credits_balance = $1 WHERE organisation_id = $2 AND status = 'approved'`,
      [org.quadratic_credits, org.id],
    );
    await this.orgRepo.update(org.id, { credits_allocated_at: new Date() });
    this.auditLog.log(org.id, actorId, 'credits.allocated', 'org', org.id, { credits: org.quadratic_credits });
    return { count: result[1] ?? 0 };
  }

  async exportSnapshotFormat(slug: string, actorId: string): Promise<object[]> {
    const org = await this.orgRepo.findOneByOrFail({ slug });
    await this.requireRole(org.id, actorId, ['admin', 'moderator']);

    const proposals = await this.dataSource.getRepository(Proposal).find({ where: { organisation_id: org.id } });
    const votes = await this.dataSource.getRepository(Vote).find({ where: { organisation_id: org.id } });
    const options = await this.dataSource.query(
      `SELECT * FROM proposal_options WHERE organisation_id = $1`, [org.id],
    );

    return proposals.map((p) => {
      const pVotes = votes.filter((v) => v.proposal_id === p.id);
      const pOptions = options.filter((o: any) => o.proposal_id === p.id).sort((a: any, b: any) => a.position - b.position);

      let choices: string[];
      let scores: number[];
      let type: string;
      if (['multiple_choice', 'approval', 'score_voting', 'ranked_choice'].includes(p.proposal_type)) {
        choices = pOptions.map((o: any) => o.text);
        scores = pOptions.map((o: any) => pVotes.filter((v) => v.option_id === o.id).length);
        type = p.proposal_type === 'approval' ? 'approval' : p.proposal_type === 'ranked_choice' ? 'ranked-choice' : 'single-choice';
      } else {
        choices = ['For', 'Against', 'Abstain'];
        scores = [
          pVotes.filter((v) => v.choice === 'yes').length,
          pVotes.filter((v) => v.choice === 'no').length,
          pVotes.filter((v) => v.choice === 'abstain').length,
        ];
        type = p.proposal_type === 'consent' ? 'basic' : 'basic';
      }

      return {
        id: p.id,
        title: p.title,
        body: p.description,
        choices,
        start: Math.floor(new Date(p.created_at).getTime() / 1000),
        end: p.closes_at ? Math.floor(new Date(p.closes_at).getTime() / 1000) : null,
        snapshot: 0,
        state: p.status === 'open' ? 'active' : 'closed',
        author: p.author_id ?? '',
        network: '1',
        type,
        scores,
        scores_total: pVotes.length,
        votes: pVotes.length,
        space: { id: org.slug, name: org.name },
      };
    });
  }

  async runCreditDecay(): Promise<void> {
    const orgs = await this.orgRepo.find();
    for (const org of orgs) {
      if (!org.quadratic_credits || !org.credit_period_days || !org.credits_allocated_at) continue;
      const nextAllocation = new Date(org.credits_allocated_at);
      nextAllocation.setDate(nextAllocation.getDate() + org.credit_period_days);
      if (new Date() >= nextAllocation) {
        await this.dataSource.query(
          `UPDATE memberships SET credits_balance = $1 WHERE organisation_id = $2 AND status = 'approved'`,
          [org.quadratic_credits, org.id],
        );
        await this.orgRepo.update(org.id, { credits_allocated_at: new Date() });
      }
    }
  }

  async purgeExpiredProposals(): Promise<number> {
    const orgs = await this.dataSource.query<Array<{ id: string; data_retention_months: number }>>(
      `SELECT id, data_retention_months FROM organisations WHERE data_retention_months IS NOT NULL`,
    );
    let total = 0;
    for (const org of orgs) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - org.data_retention_months);
      const result = await this.dataSource.query(
        `DELETE FROM proposals WHERE organisation_id = $1 AND status = 'closed' AND closed_at < $2`,
        [org.id, cutoff],
      );
      total += result[1] ?? 0;
    }
    return total;
  }
}
