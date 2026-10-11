import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Not, Repository } from 'typeorm';
import { randomUUID, createHmac, createHash } from 'crypto';
import { ImpactLevel, Proposal, ProposalStatus } from './proposal.entity';
import { ProposalOption } from './proposal-option.entity';
import { ProposalReaction } from './proposal-reaction.entity';
import { ProposalSignature } from './proposal-signature.entity';
import { ProposalVersion } from './proposal-version.entity';
import { ProposalLink, ProposalLinkType } from './proposal-link.entity';
import { ProposalBoost } from './proposal-boost.entity';
import { Prediction } from './prediction.entity';
import { Endorsement } from '../endorsements/endorsement.entity';
import { Topic } from '../topics/topic.entity';
import { Vote } from '../votes/vote.entity';
import { Delegation } from '../delegations/delegation.entity';
import { Organisation } from '../organisations/organisation.entity';
import { Membership } from '../organisations/membership.entity';
import { DelegationsService } from '../delegations/delegations.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SlackService } from '../slack/slack.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { DiscordService } from '../discord/discord.service';
import { User } from '../users/user.entity';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 10_000;

export interface TallyResult {
  yes: number;
  no: number;
  abstain: number;
  total: number;
  eligible_count: number | null;
  quorum_met: boolean | null;
  options: Array<{ id: string; text: string; count: number; position: number; mean_score?: number; irv_rounds?: Array<{ eliminated: string | null; counts: Record<string, number> }> }>;
}

export interface DelegationVote {
  delegate_id: string;
  choice: string;
}

const ROLE_RANK: Record<string, number> = { member: 1, moderator: 2, admin: 3 };

const IMPACT_QUORUM_MULTIPLIER: Record<string, number> = {
  low: 0.5,
  medium: 1.0,
  high: 1.5,
  constitutional: 2.0,
};

@Injectable()
export class ProposalsService {
  constructor(
    @InjectRepository(Proposal)
    private readonly proposalRepo: Repository<Proposal>,
    @InjectRepository(ProposalVersion)
    private readonly versionRepo: Repository<ProposalVersion>,
    @InjectRepository(Organisation)
    private readonly orgRepo: Repository<Organisation>,
    @InjectRepository(Membership)
    private readonly memberRepo: Repository<Membership>,
    @InjectRepository(ProposalReaction)
    private readonly reactionRepo: Repository<ProposalReaction>,
    @InjectRepository(ProposalBoost)
    private readonly boostRepo: Repository<ProposalBoost>,
    @InjectRepository(Prediction)
    private readonly predictionRepo: Repository<Prediction>,
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
    private readonly slack: SlackService,
    private readonly webhooks: WebhooksService,
    private readonly discord: DiscordService,
  ) {}

  findByOrg(organisationId: string): Promise<Proposal[]> {
    return this.proposalRepo.find({ where: { organisation_id: organisationId }, order: { created_at: 'DESC' } });
  }

  async findPaginated(params: {
    organisation_id?: string;
    status?: string;
    topic_id?: string;
    author_id?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
    /** Drafts are only listed for their author. */
    viewerId?: string | null;
  }): Promise<{ items: Proposal[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (params.organisation_id) where['organisation_id'] = params.organisation_id;
    if (params.status) where['status'] = params.status;
    if (params.topic_id) where['topic_id'] = params.topic_id;
    if (params.author_id) where['author_id'] = params.author_id;

    const order: Record<string, 'ASC' | 'DESC'> =
      params.sort === 'closes_at' ? { closes_at: 'ASC' }
      : params.sort === 'oldest' ? { created_at: 'ASC' }
      : { created_at: 'DESC' };

    const viewerId = params.viewerId ?? null;
    let visible: Record<string, unknown> | Record<string, unknown>[];
    if (params.status === 'draft') {
      if (!viewerId || (params.author_id && params.author_id !== viewerId)) {
        return { items: [], total: 0, page, pageSize };
      }
      visible = { ...where, author_id: viewerId };
    } else if (params.status) {
      visible = where;
    } else {
      visible = [{ ...where, status: Not('draft') }];
      if (viewerId && (!params.author_id || params.author_id === viewerId)) {
        visible.push({ ...where, status: 'draft', author_id: viewerId });
      }
    }

    const [items, total] = await this.proposalRepo.findAndCount({
      where: visible as any,
      order: order as any,
      skip,
      take: pageSize,
    });

    return { items, total, page, pageSize };
  }

  async getEmbedData(id: string): Promise<{ proposal: Proposal; tally: object; org: { slug: string; name: string } } | null> {
    const proposal = await this.proposalRepo.findOneBy({ id });
    if (!proposal) return null;
    const org = await this.orgRepo.findOneBy({ id: proposal.organisation_id });
    if (!org) return null;
    const tally = await this.tally(id).catch(() => null);
    return { proposal, tally: tally ?? {}, org: { slug: org.slug, name: org.name } };
  }

  async getOgImage(id: string): Promise<string | null> {
    const proposal = await this.proposalRepo.findOneBy({ id });
    if (!proposal) return null;
    const org = await this.orgRepo.findOneBy({ id: proposal.organisation_id });
    const tally = await this.tally(id).catch(() => null);

    const width = 1200;
    const height = 630;
    const total = tally ? tally.yes + tally.no + tally.abstain : 0;
    const yesP = total > 0 ? Math.round((tally!.yes / total) * 100) : 0;
    const noP = total > 0 ? Math.round((tally!.no / total) * 100) : 0;
    const abstainP = total > 0 ? 100 - yesP - noP : 0;

    const title = proposal.title.length > 80 ? proposal.title.slice(0, 77) + '…' : proposal.title;
    const orgName = org?.name ?? 'Ripple';
    const statusLabel = proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1);
    const statusColor = proposal.status === 'open' ? '#1a7a1a' : '#666';
    const statusBg = proposal.status === 'open' ? '#e6f7e6' : '#f0f0f0';

    const barWidth = 860;
    const yesW = Math.round(barWidth * yesP / 100);
    const noW = Math.round(barWidth * noP / 100);
    const abstainW = barWidth - yesW - noW;

    const lines: string[] = [];
    const words = title.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > 42 && line) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);

    const titleY = lines.length === 1 ? 260 : lines.length === 2 ? 245 : 230;
    const titleSvg = lines.map((l, i) =>
      `<text x="170" y="${titleY + i * 58}" font-family="system-ui,sans-serif" font-size="48" font-weight="600" fill="#111">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`
    ).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fff"/>
  <rect x="0" y="0" width="8" height="${height}" fill="#111"/>
  <text x="170" y="80" font-family="system-ui,sans-serif" font-size="22" font-weight="600" fill="#888">${orgName.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
  <rect x="170" y="100" width="1" height="1" fill="none"/>
  ${titleSvg}
  <rect x="170" y="${titleY + lines.length * 58 + 10}" rx="12" width="90" height="30" fill="${statusBg}"/>
  <text x="215" y="${titleY + lines.length * 58 + 30}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${statusColor}">${statusLabel}</text>
  ${total > 0 ? `
  <text x="170" y="490" font-family="system-ui,sans-serif" font-size="16" fill="#444">For</text>
  <text x="${170 + barWidth - 10}" y="490" text-anchor="end" font-family="system-ui,sans-serif" font-size="16" fill="#1a7a1a">${yesP}%</text>
  <rect x="170" y="498" width="${barWidth}" height="10" rx="5" fill="#eee"/>
  <rect x="170" y="498" width="${yesW}" height="10" rx="5" fill="#1a7a1a"/>
  <text x="170" y="532" font-family="system-ui,sans-serif" font-size="16" fill="#444">Against</text>
  <text x="${170 + barWidth - 10}" y="532" text-anchor="end" font-family="system-ui,sans-serif" font-size="16" fill="#c00">${noP}%</text>
  <rect x="170" y="540" width="${barWidth}" height="10" rx="5" fill="#eee"/>
  <rect x="170" y="540" width="${noW}" height="10" rx="5" fill="#c00"/>
  <text x="170" y="574" font-family="system-ui,sans-serif" font-size="16" fill="#444">Abstain</text>
  <text x="${170 + barWidth - 10}" y="574" text-anchor="end" font-family="system-ui,sans-serif" font-size="16" fill="#888">${abstainP}%</text>
  <rect x="170" y="582" width="${barWidth}" height="10" rx="5" fill="#eee"/>
  <rect x="170" y="582" width="${abstainW}" height="10" rx="5" fill="#888"/>
  <text x="170" y="618" font-family="system-ui,sans-serif" font-size="14" fill="#aaa">${total} vote${total !== 1 ? 's' : ''} cast</text>
  ` : `<text x="170" y="520" font-family="system-ui,sans-serif" font-size="22" fill="#aaa">No votes yet</text>`}
  <text x="${width - 30}" y="${height - 20}" text-anchor="end" font-family="system-ui,sans-serif" font-size="18" font-weight="600" fill="#ccc">Ripple</text>
</svg>`;
  }

  findOne(id: string): Promise<Proposal | null> {
    return this.proposalRepo.findOneBy({ id });
  }

  async create(data: {
    id: string;
    organisation_id: string;
    topic_id: string;
    author_id: string;
    title: string;
    description?: string;
    closes_at?: string | null;
    opens_at?: string | null;
    deliberation_ends_at?: string | null;
    threshold?: number;
    quorum?: number | null;
    quorum_type?: 'soft' | 'hard';
    status?: 'open' | 'draft';
    proposal_type?: 'standard' | 'discussion' | 'multiple_choice' | 'temperature_check' | 'consent' | 'approval' | 'score_voting' | 'ranked_choice' | 'petition' | 'amendment';
    tags?: string[];
    impact_level?: ImpactLevel | null;
    signature_threshold?: number | null;
    parent_proposal_id?: string | null;
    amendment_text?: string | null;
    anonymous_voting?: boolean;
    conviction_voting?: boolean;
    quadratic_voting?: boolean;
  }): Promise<{ item: Proposal; txid: number }> {
    const title = data.title?.trim();
    if (!title) throw new BadRequestException('Title is required');
    if (title.length > TITLE_MAX) throw new BadRequestException(`Title must be ${TITLE_MAX} characters or fewer`);
    if (data.description && data.description.length > DESCRIPTION_MAX) {
      throw new BadRequestException(`Description must be ${DESCRIPTION_MAX} characters or fewer`);
    }

    const org = await this.orgRepo.findOneBy({ id: data.organisation_id });
    if (!org) throw new NotFoundException('Organisation not found');
    const membership = await this.memberRepo.findOneBy({ organisation_id: data.organisation_id, user_id: data.author_id });
    if (!membership) throw new ForbiddenException('Not a member of this organisation');
    const required = ROLE_RANK[org.proposal_creation_role] ?? 1;
    const actual = ROLE_RANK[membership.role] ?? 0;
    if (actual < required) {
      throw new ForbiddenException(`Only ${org.proposal_creation_role}s and above can create proposals`);
    }

    if (data.proposal_type === 'amendment') {
      if (!data.parent_proposal_id) throw new BadRequestException('Amendment requires a parent proposal');
      if (!data.amendment_text?.trim()) throw new BadRequestException('Amendment text is required');
      const parent = await this.proposalRepo.findOneBy({ id: data.parent_proposal_id });
      if (!parent || parent.status !== 'open') throw new BadRequestException('Parent proposal must be open');
    }

    const topic = await this.dataSource.getRepository(Topic).findOneBy({ id: data.topic_id });
    if (topic?.is_constitutional) {
      const threshold = data.threshold ?? org.default_threshold;
      if (threshold < 66) {
        throw new BadRequestException('Constitutional topics require a supermajority threshold of at least 66%');
      }
      if (!data.deliberation_ends_at) {
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        (data as Record<string, unknown>).deliberation_ends_at = sevenDaysFromNow.toISOString();
      }
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const proposal = manager.create(Proposal, {
        description: '',
        closed_at: null,
        threshold: 50,
        ...data,
        status: data.opens_at ? 'draft' : (data.status ?? 'open'),
        closes_at: data.closes_at ? new Date(data.closes_at) : null,
        opens_at: data.opens_at ? new Date(data.opens_at) : null,
        deliberation_ends_at: data.deliberation_ends_at ? new Date(data.deliberation_ends_at) : null,
      });
      const saved = await manager.save(proposal);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item: saved, txid: parseInt(row.txid, 10) };
    });
    this.auditLog.log(data.organisation_id, data.author_id, 'proposal.created', 'proposal', result.item.id, { title: result.item.title, status: result.item.status });
    return result;
  }

  async bulkImport(
    orgSlug: string,
    actorId: string,
    rows: Array<{ title: string; description?: string; topic_id: string; closes_at?: string; status?: 'open' | 'draft'; tags?: string[] }>,
  ): Promise<{ created: number; errors: Array<{ index: number; message: string }> }> {
    const org = await this.orgRepo.findOneBy({ slug: orgSlug });
    if (!org) throw new NotFoundException('Organisation not found');

    const membership = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: actorId });
    if (!membership) throw new ForbiddenException('Not a member of this organisation');
    const required = ROLE_RANK[org.proposal_creation_role] ?? 1;
    if ((ROLE_RANK[membership.role] ?? 0) < required) {
      throw new ForbiddenException(`Only ${org.proposal_creation_role}s and above can create proposals`);
    }

    let created = 0;
    const errors: Array<{ index: number; message: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const title = row.title?.trim();
        if (!title) { errors.push({ index: i, message: 'Title is required' }); continue; }
        if (title.length > TITLE_MAX) { errors.push({ index: i, message: `Title too long (max ${TITLE_MAX})` }); continue; }
        if (!row.topic_id) { errors.push({ index: i, message: 'topic_id is required' }); continue; }

        await this.dataSource.transaction(async (manager) => {
          const proposal = manager.create(Proposal, {
            id: randomUUID(),
            organisation_id: org.id,
            author_id: actorId,
            title,
            description: row.description ?? '',
            topic_id: row.topic_id,
            status: row.status ?? 'open',
            closes_at: row.closes_at ? new Date(row.closes_at) : null,
            tags: row.tags ?? [],
            threshold: 50,
            closed_at: null,
          });
          await manager.save(proposal);
          this.auditLog.log(org.id, actorId, 'proposal.created', 'proposal', proposal.id, { title: proposal.title, status: proposal.status, bulk_import: true });
        });
        created++;
      } catch (err) {
        errors.push({ index: i, message: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return { created, errors };
  }

  async update(
    id: string,
    data: Partial<Pick<Proposal, 'title' | 'description' | 'status' | 'closed_at' | 'closes_at' | 'deliberation_ends_at' | 'threshold' | 'outcome' | 'pinned' | 'tags' | 'anonymous_voting'>>,
  ): Promise<{ item: Proposal; txid: number }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Proposal, id, data);
      const item = await manager.findOneByOrFail(Proposal, { id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
  }

  private async canModerate(orgId: string, userId: string): Promise<boolean> {
    const m = await this.memberRepo.findOneBy({ organisation_id: orgId, user_id: userId });
    return !!m && (ROLE_RANK[m.role] ?? 0) >= ROLE_RANK['moderator'];
  }

  async edit(
    id: string,
    userId: string,
    data: { title?: string; description?: string; tags?: string[] },
  ): Promise<{ item: Proposal; txid: number }> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id });
    if (proposal.author_id !== userId && !(await this.canModerate(proposal.organisation_id, userId))) {
      throw new ForbiddenException('Only the author or a moderator can edit this proposal');
    }
    if (!['open', 'draft'].includes(proposal.status)) {
      throw new BadRequestException('Only open or draft proposals can be edited');
    }
    if (data.title !== undefined) {
      const title = data.title.trim();
      if (!title) throw new BadRequestException('Title is required');
      if (title.length > TITLE_MAX) throw new BadRequestException(`Title must be ${TITLE_MAX} characters or fewer`);
      data = { ...data, title };
    }
    if (data.description !== undefined && data.description.length > DESCRIPTION_MAX) {
      throw new BadRequestException(`Description must be ${DESCRIPTION_MAX} characters or fewer`);
    }

    // Save a version snapshot of the current state before overwriting
    await this.versionRepo.save(
      this.versionRepo.create({
        id: randomUUID(),
        proposal_id: id,
        changed_by: userId,
        title: proposal.title,
        description: proposal.description ?? '',
      }),
    );

    return this.update(id, data);
  }

  async setPin(id: string, userId: string, pinned: boolean): Promise<{ item: Proposal; txid: number }> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id });
    if (!(await this.canModerate(proposal.organisation_id, userId))) {
      throw new ForbiddenException('Only moderators and admins can pin proposals');
    }
    return this.update(id, { pinned });
  }

  async listVersions(proposalId: string): Promise<ProposalVersion[]> {
    return this.versionRepo.find({
      where: { proposal_id: proposalId },
      order: { created_at: 'DESC' },
    });
  }

  async delete(id: string): Promise<{ txid: number }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(Proposal, id);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
  }

  private async transition(
    id: string,
    userId: string,
    from: ProposalStatus | ProposalStatus[],
    to: ProposalStatus,
    patch: Partial<Pick<Proposal, 'status' | 'closed_at'>>,
    allowModerator = false,
  ): Promise<{ item: Proposal; txid: number }> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id });
    if (proposal.author_id !== userId) {
      const permitted = allowModerator && await this.canModerate(proposal.organisation_id, userId);
      if (!permitted) throw new ForbiddenException('Only the author or a moderator can perform this action');
    }
    const allowed = Array.isArray(from) ? from : [from];
    if (!allowed.includes(proposal.status)) {
      throw new BadRequestException(`Proposal must be ${allowed.join(' or ')} to perform this action`);
    }
    return this.update(id, patch);
  }

  async publish(id: string, userId: string) {
    const proposal = await this.proposalRepo.findOneByOrFail({ id });
    const org = await this.orgRepo.findOneByOrFail({ id: proposal.organisation_id });

    if ((org.min_endorsements ?? 0) > 0) {
      const endorsementCount = await this.dataSource.getRepository(Endorsement).count({ where: { proposal_id: id } });
      if (endorsementCount < org.min_endorsements) {
        throw new BadRequestException(
          `This proposal needs ${org.min_endorsements} endorsement${org.min_endorsements !== 1 ? 's' : ''} before it can be published (${endorsementCount} so far)`,
        );
      }
    }

    const result = await this.transition(id, userId, 'draft', 'open', { status: 'open' });
    this.auditLog.log(result.item.organisation_id, userId, 'proposal.published', 'proposal', id, { title: result.item.title });
    await this.notifyOrgMembers(result.item.organisation_id, userId, {
      type: 'proposal.opened',
      actorId: userId,
      targetType: 'proposal',
      targetId: id,
      metadata: { title: result.item.title },
    });
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
    this.slack.postProposalOpened(org.id, result.item.title, `${appUrl}/orgs/${org.slug}/proposals/${id}`).catch(() => {});
    this.discord.postProposalOpened(org.id, result.item.title, `${appUrl}/orgs/${org.slug}/proposals/${id}`).catch(() => {});
    this.webhooks.dispatch(result.item.organisation_id, 'proposal.opened', { id, title: result.item.title, author_id: result.item.author_id }).catch(() => {});
    return result;
  }

  async close(id: string, userId: string) {
    const result = await this.transition(id, userId, 'open', 'closed', { status: 'closed', closed_at: new Date() }, true);
    this.auditLog.log(result.item.organisation_id, userId, 'proposal.closed', 'proposal', id, { title: result.item.title });
    await this.notifyVoters(id, result.item.organisation_id, userId, result.item.title);
    if (result.item.proposal_type === 'amendment') {
      await this.applyAmendmentIfPassed(id).catch(() => {});
    }
    this.signConstitutionalOutcomeIfNeeded(result.item).catch(() => {});
    const closedOrg = await this.orgRepo.findOneBy({ id: result.item.organisation_id });
    if (closedOrg) {
      const tally = await this.tally(id).catch(() => null);
      const passed = tally ? tally.yes > tally.no : false;
      const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
      this.slack.postProposalClosed(closedOrg.id, result.item.title, passed ? 'passed' : 'failed', `${appUrl}/orgs/${closedOrg.slug}/proposals/${id}`).catch(() => {});
      this.discord.postProposalClosed(closedOrg.id, result.item.title, passed ? 'passed' : 'failed', `${appUrl}/orgs/${closedOrg.slug}/proposals/${id}`).catch(() => {});
      this.webhooks.dispatch(result.item.organisation_id, 'proposal.closed', { id, title: result.item.title, passed }).catch(() => {});
    }
    return result;
  }

  private async signConstitutionalOutcomeIfNeeded(proposal: Proposal): Promise<void> {
    const topic = await this.dataSource.getRepository(Topic).findOneBy({ id: proposal.topic_id });
    if (!topic?.is_constitutional) return;
    const tally = await this.tally(proposal.id).catch(() => null);
    const summary = tally ? { yes: tally.yes, no: tally.no, abstain: tally.abstain, total: tally.total } : {};
    const outcome = tally ? (tally.yes > tally.no ? 'passed' : 'failed') : 'no-votes';
    const payload = JSON.stringify({ proposal_id: proposal.id, outcome, closed_at: proposal.closed_at, summary });
    const hash = createHash('sha256').update(payload).digest('hex');
    await this.dataSource.query(
      `INSERT INTO constitutional_outcomes (proposal_id, outcome, hash, votes_summary) VALUES ($1, $2, $3, $4) ON CONFLICT (proposal_id) DO UPDATE SET outcome = $2, hash = $3, votes_summary = $4, signed_at = NOW()`,
      [proposal.id, outcome, hash, JSON.stringify(summary)],
    );
  }

  async getConstitutionalOutcome(proposalId: string): Promise<{ outcome: string; hash: string; votes_summary: object; signed_at: string } | null> {
    const [row] = await this.dataSource.query(
      `SELECT outcome, hash, votes_summary, signed_at FROM constitutional_outcomes WHERE proposal_id = $1`,
      [proposalId],
    );
    return row ?? null;
  }

  private async applyAmendmentIfPassed(amendmentId: string): Promise<void> {
    const amendment = await this.proposalRepo.findOneBy({ id: amendmentId });
    if (!amendment || amendment.proposal_type !== 'amendment' || !amendment.parent_proposal_id) return;

    const tally = await this.tally(amendmentId);
    if (tally.yes <= tally.no) return; // simple majority required

    await this.dataSource.transaction(async (manager) => {
      const parent = await manager.findOneBy(Proposal, { id: amendment.parent_proposal_id! });
      if (!parent) return;

      // Create a version of the parent before updating
      const version = manager.create(ProposalVersion, {
        id: randomUUID(),
        proposal_id: parent.id,
        organisation_id: parent.organisation_id,
        editor_id: amendment.author_id,
        title: parent.title,
        description: parent.description,
        created_at: new Date(),
      });
      await manager.save(version);

      // Update parent description with amendment text
      await manager.update(Proposal, parent.id, { description: amendment.amendment_text! });

      // Reset all votes on the parent
      await manager.delete(Vote, { proposal_id: parent.id });

      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return parseInt(row.txid, 10);
    });
  }

  async reopen(id: string, userId: string) {
    const result = await this.transition(id, userId, 'closed', 'open', { status: 'open', closed_at: null }, true);
    this.auditLog.log(result.item.organisation_id, userId, 'proposal.reopened', 'proposal', id, { title: result.item.title });
    return result;
  }

  async withdraw(id: string, userId: string) {
    const result = await this.transition(id, userId, ['open', 'closed'], 'withdrawn', { status: 'withdrawn', closed_at: new Date() }, true);
    this.auditLog.log(result.item.organisation_id, userId, 'proposal.withdrawn', 'proposal', id, { title: result.item.title });
    return result;
  }

  async setOutcome(
    id: string,
    userId: string,
    outcome: 'implemented' | 'not_implemented' | 'in_progress' | null,
  ): Promise<{ item: Proposal; txid: number }> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id });
    if (proposal.status !== 'closed') throw new BadRequestException('Outcome can only be set on closed proposals');
    if (!(await this.canModerate(proposal.organisation_id, userId))) {
      throw new ForbiddenException('Only moderators and admins can set proposal outcomes');
    }
    return this.update(id, { outcome });
  }

  async autoOpenScheduled(): Promise<number> {
    const scheduled = await this.proposalRepo.find({
      where: { status: 'draft', opens_at: LessThanOrEqual(new Date()) },
    });
    if (scheduled.length === 0) return 0;

    await Promise.all(
      scheduled.map(async (p) => {
        await this.proposalRepo.update(p.id, { status: 'open', opens_at: null });
        await this.notifyOrgMembers(p.organisation_id, p.author_id, {
          type: 'proposal.opened',
          actorId: p.author_id,
          targetType: 'proposal',
          targetId: p.id,
          metadata: { title: p.title },
        });
        this.webhooks.dispatch(p.organisation_id, 'proposal.opened', { id: p.id, title: p.title, author_id: p.author_id }).catch(() => {});
      }),
    );
    return scheduled.length;
  }

  async purgeByRetentionPolicy(): Promise<number> {
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

  async autoCloseExpired(): Promise<number> {
    const expired = await this.proposalRepo.find({
      where: { status: 'open', closes_at: LessThanOrEqual(new Date()) },
    });
    if (expired.length === 0) return 0;

    const now = new Date();
    await Promise.all(
      expired.map(async (p) => {
        await this.proposalRepo.update(p.id, { status: 'closed', closed_at: now });
        await this.notifyVoters(p.id, p.organisation_id, null, p.title);
        if (p.proposal_type === 'amendment') {
          await this.applyAmendmentIfPassed(p.id).catch(() => {});
        }
        this.signConstitutionalOutcomeIfNeeded(p).catch(() => {});
        this.webhooks.dispatch(p.organisation_id, 'proposal.closed', { id: p.id, title: p.title }).catch(() => {});
      }),
    );
    return expired.length;
  }

  private async notifyOrgMembers(
    orgId: string,
    excludeUserId: string | null,
    data: { type: Parameters<NotificationsService['create']>[0]['type']; actorId?: string | null; targetType?: string; targetId?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const members = await this.memberRepo.find({ where: { organisation_id: orgId, status: 'approved' as any } });
      const recipients = members
        .filter((m) => m.user_id !== excludeUserId)
        .map((m) => ({ userId: m.user_id, orgId, ...data }));
      await this.notifications.createMany(recipients);
    } catch { /* non-critical */ }
  }

  private async notifyVoters(proposalId: string, orgId: string, actorId: string | null, title: string): Promise<void> {
    try {
      const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
      const recipients = votes.map((v) => ({
        userId: v.user_id,
        orgId,
        type: 'proposal.closed' as const,
        actorId,
        targetType: 'proposal',
        targetId: proposalId,
        metadata: { title },
      }));
      await this.notifications.createMany(recipients);
    } catch { /* non-critical */ }
  }

  private buildDelegationMap(delegations: Delegation[]): Map<string, Map<string | null, string>> {
    const map = new Map<string, Map<string | null, string>>();
    for (const d of delegations) {
      if (!map.has(d.delegator_id)) map.set(d.delegator_id, new Map());
      map.get(d.delegator_id)!.set(d.topic_id, d.delegate_id);
    }
    return map;
  }

  private buildSplitDelegationMap(delegations: Delegation[]): Map<string, Map<string | null, Array<{ delegate_id: string; weight_fraction: number }>>> {
    const map = new Map<string, Map<string | null, Array<{ delegate_id: string; weight_fraction: number }>>>();
    for (const d of delegations) {
      if (!map.has(d.delegator_id)) map.set(d.delegator_id, new Map());
      const topicMap = map.get(d.delegator_id)!;
      if (!topicMap.has(d.topic_id)) topicMap.set(d.topic_id, []);
      topicMap.get(d.topic_id)!.push({ delegate_id: d.delegate_id, weight_fraction: Number(d.weight_fraction) || 1 });
    }
    return map;
  }

  async listOptions(proposalId: string): Promise<ProposalOption[]> {
    return this.dataSource.getRepository(ProposalOption).find({
      where: { proposal_id: proposalId },
      order: { position: 'ASC' },
    });
  }

  async createOption(proposalId: string, userId: string, data: { id: string; text: string; position: number }): Promise<ProposalOption> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    if (proposal.author_id !== userId && !(await this.canModerate(proposal.organisation_id, userId))) {
      throw new ForbiddenException('Only the author or moderators can add options');
    }
    if (!data.text.trim()) throw new BadRequestException('Option text is required');
    if (data.text.length > 500) throw new BadRequestException('Option text must be 500 characters or less');
    const repo = this.dataSource.getRepository(ProposalOption);
    return repo.save(repo.create({
      id: data.id || randomUUID(),
      proposal_id: proposalId,
      organisation_id: proposal.organisation_id,
      text: data.text.trim(),
      position: data.position ?? 0,
    }));
  }

  async deleteOption(optionId: string, userId: string): Promise<void> {
    const option = await this.dataSource.getRepository(ProposalOption).findOneByOrFail({ id: optionId });
    const proposal = await this.proposalRepo.findOneByOrFail({ id: option.proposal_id });
    if (proposal.author_id !== userId && !(await this.canModerate(proposal.organisation_id, userId))) {
      throw new ForbiddenException('Only the author or moderators can remove options');
    }
    await this.dataSource.getRepository(ProposalOption).delete(optionId);
  }

  async listReactions(proposalId: string): Promise<ProposalReaction[]> {
    return this.reactionRepo.find({ where: { proposal_id: proposalId }, order: { created_at: 'ASC' } });
  }

  async reactToProposal(
    proposalId: string,
    userId: string,
    emoji: string,
  ): Promise<ProposalReaction> {
    const ALLOWED = ['👍', '👎', '💬', '🎉', '🤔'];
    if (!ALLOWED.includes(emoji)) throw new BadRequestException('Invalid reaction emoji');

    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });

    const existing = await this.reactionRepo.findOneBy({ proposal_id: proposalId, user_id: userId });
    if (existing) {
      if (existing.emoji === emoji) {
        await this.reactionRepo.delete(existing.id);
        return existing;
      }
      await this.reactionRepo.update(existing.id, { emoji });
      return this.reactionRepo.findOneByOrFail({ id: existing.id });
    }

    const reaction = this.reactionRepo.create({
      id: randomUUID(),
      proposal_id: proposalId,
      organisation_id: proposal.organisation_id,
      user_id: userId,
      emoji,
    });
    return this.reactionRepo.save(reaction);
  }

  async removeReaction(proposalId: string, userId: string): Promise<void> {
    await this.reactionRepo.delete({ proposal_id: proposalId, user_id: userId });
  }

  async selectJury(proposalId: string, actorId: string, size: number): Promise<Array<{ user_id: string; name: string }>> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    if (!(await this.canModerate(proposal.organisation_id, actorId))) {
      throw new ForbiddenException('Only moderators and above can select a jury');
    }
    if (proposal.status !== 'open') throw new BadRequestException('Jury can only be selected for open proposals');
    if (size < 1 || size > 100) throw new BadRequestException('Jury size must be between 1 and 100');

    const members = await this.memberRepo.find({ where: { organisation_id: proposal.organisation_id, status: 'approved' as any } });
    if (members.length < size) throw new BadRequestException(`Not enough members (${members.length}) to select a jury of ${size}`);

    const shuffled = [...members].sort(() => Math.random() - 0.5);
    const jurors = shuffled.slice(0, size);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM proposal_juries WHERE proposal_id = $1`, [proposalId]);
      for (const m of jurors) {
        await manager.query(`INSERT INTO proposal_juries (proposal_id, user_id) VALUES ($1, $2)`, [proposalId, m.user_id]);
      }
      await manager.update(Proposal, proposalId, { jury_size: size });
    });

    const users = await this.dataSource.query<Array<{ id: string; name: string }>>(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [jurors.map((m) => m.user_id)],
    );
    const nameMap = new Map(users.map((u) => [u.id, u.name]));
    return jurors.map((m) => ({ user_id: m.user_id, name: nameMap.get(m.user_id) ?? 'Unknown' }));
  }

  async getJury(proposalId: string): Promise<Array<{ user_id: string; name: string; has_voted: boolean }>> {
    const jurors = await this.dataSource.query<Array<{ user_id: string; name: string }>>(
      `SELECT pj.user_id, u.name FROM proposal_juries pj JOIN users u ON u.id = pj.user_id WHERE pj.proposal_id = $1`,
      [proposalId],
    );
    if (jurors.length === 0) return [];

    const votes = await this.dataSource.query<Array<{ user_id: string }>>(
      `SELECT user_id FROM votes WHERE proposal_id = $1 AND user_id = ANY($2)`,
      [proposalId, jurors.map((j) => j.user_id)],
    );
    const voted = new Set(votes.map((v) => v.user_id));
    return jurors.map((j) => ({ ...j, has_voted: voted.has(j.user_id) }));
  }

  async tally(proposalId: string): Promise<TallyResult> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });

    if (proposal.status === 'open') {
      const org = await this.dataSource.getRepository(Organisation).findOneBy({ id: proposal.organisation_id });
      if (org?.voting_visibility === 'hidden') {
        return { yes: 0, no: 0, abstain: 0, total: 0, eligible_count: null, quorum_met: null, options: [] };
      }
    }

    if (proposal.proposal_type === 'score_voting') {
      const options = await this.dataSource.getRepository(ProposalOption).find({
        where: { proposal_id: proposalId }, order: { position: 'ASC' },
      });
      const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
      const scoresMap = new Map<string, number[]>(options.map((o) => [o.id, []]));
      for (const v of votes) {
        if (v.option_id && v.score != null && scoresMap.has(v.option_id)) {
          scoresMap.get(v.option_id)!.push(v.score);
        }
      }
      const uniqueVoters = new Set(votes.map((v) => v.user_id)).size;
      return {
        yes: 0, no: 0, abstain: 0, total: uniqueVoters,
        eligible_count: null, quorum_met: null,
        options: options.map((o) => {
          const scores = scoresMap.get(o.id) ?? [];
          const mean_score = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0;
          return { id: o.id, text: o.text, count: scores.length, position: o.position, mean_score };
        }),
      };
    }

    if (proposal.proposal_type === 'ranked_choice') {
      const options = await this.dataSource.getRepository(ProposalOption).find({
        where: { proposal_id: proposalId }, order: { position: 'ASC' },
      });
      const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
      const optionIds = options.map((o) => o.id);
      const uniqueVoters = new Set(votes.map((v) => v.user_id)).size;

      const rankings = new Map<string, string[]>();
      for (const v of votes) {
        if (!v.option_id || v.rank_position == null) continue;
        if (!rankings.has(v.user_id)) rankings.set(v.user_id, []);
        const list = rankings.get(v.user_id)!;
        list[v.rank_position - 1] = v.option_id;
      }

      let remaining = new Set(optionIds);
      const irv_rounds: Array<{ eliminated: string | null; counts: Record<string, number> }> = [];

      while (remaining.size > 1) {
        const counts: Record<string, number> = {};
        for (const id of remaining) counts[id] = 0;
        for (const [, prefs] of rankings) {
          const first = prefs.find((p) => remaining.has(p));
          if (first) counts[first] = (counts[first] ?? 0) + 1;
        }
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const majority = [...remaining].find((id) => counts[id] > total / 2);
        if (majority) {
          irv_rounds.push({ eliminated: null, counts });
          remaining = new Set([majority]);
          break;
        }
        const minCount = Math.min(...Object.values(counts));
        const toEliminate = [...remaining].find((id) => counts[id] === minCount)!;
        irv_rounds.push({ eliminated: toEliminate, counts });
        remaining.delete(toEliminate);
      }

      const winner = remaining.size === 1 ? [...remaining][0] : null;
      return {
        yes: 0, no: 0, abstain: 0, total: uniqueVoters,
        eligible_count: null, quorum_met: null,
        options: options.map((o) => ({
          id: o.id, text: o.text, position: o.position,
          count: irv_rounds.length > 0 ? (irv_rounds[irv_rounds.length - 1].counts[o.id] ?? 0) : 0,
          mean_score: o.id === winner ? 1 : 0,
          irv_rounds: irv_rounds.length > 0 ? irv_rounds : undefined,
        })),
      };
    }

    if (['multiple_choice', 'approval'].includes(proposal.proposal_type)) {
      const options = await this.dataSource.getRepository(ProposalOption).find({
        where: { proposal_id: proposalId },
        order: { position: 'ASC' },
      });
      const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
      const countMap = new Map<string, number>(options.map((o) => [o.id, 0]));
      for (const v of votes) {
        if (v.option_id && countMap.has(v.option_id)) {
          countMap.set(v.option_id, countMap.get(v.option_id)! + 1);
        }
      }
      const uniqueVoters = new Set(votes.map((v) => v.user_id)).size;
      return {
        yes: 0, no: 0, abstain: 0,
        total: proposal.proposal_type === 'approval' ? uniqueVoters : votes.length,
        eligible_count: null, quorum_met: null,
        options: options.map((o) => ({ id: o.id, text: o.text, count: countMap.get(o.id)!, position: o.position })),
      };
    }

    const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
    const allDelegations = await this.dataSource.getRepository(Delegation).find({ where: { organisation_id: proposal.organisation_id } });
    const directVotes = new Map<string, string>(votes.map((v) => [v.user_id, v.choice ?? 'abstain']));

    const now = new Date();
    const closesAt = proposal.closes_at ? new Date(proposal.closes_at) : null;
    const delegations = DelegationsService.activeDelegations(allDelegations).filter((d) => {
      if (!d.fallback_abstain_hours || !closesAt) return true;
      const cutoff = new Date(closesAt.getTime() - d.fallback_abstain_hours * 3600_000);
      if (now < cutoff) return true;
      return directVotes.has(d.delegate_id);
    });

    const splitDelegationMap = this.buildSplitDelegationMap(delegations);

    const MAX_DEPTH = 10;
    const resolveWeightedChoices = (userId: string, visited: Set<string>): Map<string, number> => {
      if (visited.has(userId) || visited.size >= MAX_DEPTH) return new Map([['abstain', 1]]);
      if (directVotes.has(userId)) return new Map([[directVotes.get(userId)!, 1]]);
      const userDelegations = splitDelegationMap.get(userId);
      if (!userDelegations) return new Map([['abstain', 1]]);
      const topicDelegates = userDelegations.get(proposal.topic_id) ?? userDelegations.get(null);
      if (!topicDelegates || topicDelegates.length === 0) return new Map([['abstain', 1]]);
      const totalFraction = topicDelegates.reduce((s, d) => s + d.weight_fraction, 0);
      const normalize = totalFraction > 1 ? 1 / totalFraction : 1;
      const visited2 = new Set(visited);
      visited2.add(userId);
      const result = new Map<string, number>();
      for (const { delegate_id, weight_fraction } of topicDelegates) {
        const frac = weight_fraction * normalize;
        for (const [choice, choiceFrac] of resolveWeightedChoices(delegate_id, visited2)) {
          result.set(choice, (result.get(choice) ?? 0) + frac * choiceFrac);
        }
      }
      return result;
    };

    const allUsers = new Set<string>([
      ...votes.map((v) => v.user_id),
      ...delegations.map((d) => d.delegator_id),
    ]);

    const memberships = await this.memberRepo.find({
      where: { organisation_id: proposal.organisation_id, status: 'approved' as any },
    });
    const org = await this.orgRepo.findOneBy({ id: proposal.organisation_id });
    const ROLE_WEIGHT: Record<string, number> = { admin: 3, moderator: 2, member: 1, observer: 0 };
    const weightMap = new Map<string, number>(memberships.map((m) => {
      const w = org?.weight_mode === 'by_role' ? (ROLE_WEIGHT[m.role] ?? 1) : ((m as any).weight ?? 1);
      return [m.user_id, w];
    }));

    const voteTimeMap = new Map<string, Date>(votes.map((v) => [v.user_id, v.created_at]));
    const voteCountMap = new Map<string, number>(votes.map((v) => [v.user_id, (v as any).vote_count ?? 1]));
    const convictionNow = new Date();

    const tally: TallyResult = { yes: 0, no: 0, abstain: 0, total: 0, eligible_count: null, quorum_met: null, options: [] };
    for (const userId of allUsers) {
      const choices = resolveWeightedChoices(userId, new Set());
      let weight = weightMap.get(userId) ?? 1;
      if (proposal.conviction_voting && voteTimeMap.has(userId)) {
        const daysHeld = Math.max(1, Math.ceil((convictionNow.getTime() - voteTimeMap.get(userId)!.getTime()) / 86_400_000));
        weight = weight * daysHeld;
      }
      if ((proposal as any).quadratic_voting && voteCountMap.has(userId)) {
        weight = weight * (voteCountMap.get(userId) ?? 1);
      }
      for (const [choice, fraction] of choices) {
        const contribution = weight * fraction;
        if (choice === 'yes') tally.yes += contribution;
        else if (choice === 'no') tally.no += contribution;
        else tally.abstain += contribution;
        tally.total += contribution;
      }
    }

    if (proposal.quorum != null) {
      const totalWeight = memberships.reduce((sum, m) => sum + (weightMap.get(m.user_id) ?? 1), 0);
      tally.eligible_count = totalWeight;
      const multiplier = proposal.impact_level ? (IMPACT_QUORUM_MULTIPLIER[proposal.impact_level] ?? 1.0) : 1.0;
      const effectiveQuorum = Math.min(100, proposal.quorum * multiplier);
      tally.quorum_met = totalWeight > 0
        ? (tally.total / totalWeight) * 100 >= effectiveQuorum
        : false;
    }

    if (proposal.jury_size) {
      const jurors = await this.dataSource.query<Array<{ user_id: string }>>(
        `SELECT user_id FROM proposal_juries WHERE proposal_id = $1`,
        [proposalId],
      );
      if (jurors.length > 0) {
        const votedJurors = await this.dataSource.query<Array<{ user_id: string }>>(
          `SELECT user_id FROM votes WHERE proposal_id = $1 AND user_id = ANY($2)`,
          [proposalId, jurors.map((j) => j.user_id)],
        );
        tally.quorum_met = votedJurors.length >= jurors.length;
        tally.eligible_count = jurors.length;
      }
    }

    return tally;
  }

  async exportVotesCsv(proposalId: string): Promise<string> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    if (proposal.status === 'open') {
      const org = await this.dataSource.getRepository(Organisation).findOneBy({ id: proposal.organisation_id });
      if (org?.voting_visibility === 'hidden') throw new ForbiddenException('Votes are hidden until this proposal closes');
    }
    const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
    const isAnon = proposal.anonymous_voting;

    const userIds = isAnon ? [] : [...new Set(votes.map((v) => v.user_id))];
    const users = userIds.length > 0
      ? await this.dataSource.getRepository(User).findBy(userIds.map((id) => ({ id })))
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    if (['multiple_choice', 'approval'].includes(proposal.proposal_type)) {
      const options = await this.dataSource.getRepository(ProposalOption).find({
        where: { proposal_id: proposalId }, order: { position: 'ASC' },
      });
      const optionMap = new Map(options.map((o) => [o.id, o.text]));
      const rows = isAnon
        ? [['option_id', 'option_text', 'voted_at']]
        : [['user_id', 'name', 'option_id', 'option_text', 'voted_at']];
      for (const v of votes) {
        const row = isAnon
          ? [v.option_id ?? '', v.option_id ? (optionMap.get(v.option_id) ?? '') : '', v.created_at instanceof Date ? v.created_at.toISOString() : String(v.created_at)]
          : [v.user_id, userMap.get(v.user_id)?.name ?? '', v.option_id ?? '', v.option_id ? (optionMap.get(v.option_id) ?? '') : '', v.created_at instanceof Date ? v.created_at.toISOString() : String(v.created_at)];
        rows.push(row);
      }
      return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    }

    const rows = isAnon ? [['choice', 'voted_at']] : [['user_id', 'name', 'choice', 'voted_at']];
    for (const v of votes) {
      const row = isAnon
        ? [v.choice ?? '', v.created_at instanceof Date ? v.created_at.toISOString() : String(v.created_at)]
        : [v.user_id, userMap.get(v.user_id)?.name ?? '', v.choice ?? '', v.created_at instanceof Date ? v.created_at.toISOString() : String(v.created_at)];
      rows.push(row);
    }
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  }

  /** Returns the full delegation chain for userId on this proposal, with each member's name and the final voter's choice. */
  async getMyDelegationChain(proposalId: string, userId: string): Promise<{ chain: { user_id: string; name: string }[]; voter: { user_id: string; name: string; choice: string } | null } | null> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
    const allDelegations = await this.dataSource.getRepository(Delegation).find({ where: { organisation_id: proposal.organisation_id } });
    const delegations = DelegationsService.activeDelegations(allDelegations);

    // User voted directly — no chain to show
    if (votes.find((v) => v.user_id === userId)) return null;

    const directVotes = new Map<string, string>(votes.map((v) => [v.user_id, v.choice ?? 'abstain']));
    const delegationMap = this.buildDelegationMap(delegations);

    // Collect the chain of user IDs
    const MAX_DEPTH = 10;
    const visited = new Set<string>([userId]);
    const chainIds: string[] = [userId];
    let current = userId;
    let voterChoice: string | null = null;
    let voterId: string | null = null;

    while (true) {
      const userDelegations = delegationMap.get(current);
      if (!userDelegations) break;
      const next = userDelegations.get(proposal.topic_id) ?? userDelegations.get(null);
      if (!next || visited.has(next) || visited.size >= MAX_DEPTH) break;
      visited.add(next);
      chainIds.push(next);
      if (directVotes.has(next)) {
        voterChoice = directVotes.get(next)!;
        voterId = next;
        break;
      }
      current = next;
    }

    // Chain of just the user means no delegation
    if (chainIds.length === 1) return null;

    // Resolve names
    const users = await this.dataSource.getRepository(User).findBy(chainIds.map((id) => ({ id })));
    const nameMap = new Map(users.map((u) => [u.id, u.name]));

    const chain = chainIds.map((id) => ({ user_id: id, name: nameMap.get(id) ?? 'Unknown' }));
    const voter = voterId ? { user_id: voterId, name: nameMap.get(voterId) ?? 'Unknown', choice: voterChoice! } : null;

    return { chain, voter };
  }

  /** Returns the delegate who voted on behalf of userId, or null if user voted directly / no delegation resolves. */
  async getMyDelegationVote(proposalId: string, userId: string): Promise<DelegationVote | null> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
    const allDelegations = await this.dataSource.getRepository(Delegation).find({ where: { organisation_id: proposal.organisation_id } });
    const delegations = DelegationsService.activeDelegations(allDelegations);

    // User voted directly — no banner needed
    if (votes.find((v) => v.user_id === userId)) return null;

    const directVotes = new Map<string, string>(votes.map((v) => [v.user_id, v.choice ?? 'abstain']));
    const delegationMap = this.buildDelegationMap(delegations);

    const MAX_DEPTH = 10;
    const visited = new Set<string>([userId]);
    let current = userId;

    while (true) {
      const userDelegations = delegationMap.get(current);
      if (!userDelegations) return null;
      const next = userDelegations.get(proposal.topic_id) ?? userDelegations.get(null);
      if (!next || visited.has(next) || visited.size >= MAX_DEPTH) return null;
      visited.add(next);

      if (directVotes.has(next)) {
        return { delegate_id: next, choice: directVotes.get(next)! };
      }
      current = next;
    }
  }

  /** Returns for each direct voter, the list of delegators whose vote they carry. Public (not shown for anonymous proposals). */
  async getVoteCarrying(proposalId: string): Promise<Array<{ voter: { user_id: string; name: string }; carrying: Array<{ user_id: string; name: string }> }>> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    if (proposal.anonymous_voting) return [];

    const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
    const allDelegations = await this.dataSource.getRepository(Delegation).find({ where: { organisation_id: proposal.organisation_id } });
    const delegations = DelegationsService.activeDelegations(allDelegations);

    const directVoterIds = new Set(votes.map((v) => v.user_id));
    const delegationMap = this.buildDelegationMap(delegations);

    // For each delegator, find who ultimately votes on their behalf
    const carried = new Map<string, string[]>(); // voterUserId -> [delegatorUserIds]

    const resolveTerminalVoter = (userId: string, visited: Set<string>): string | null => {
      if (directVoterIds.has(userId)) return userId;
      if (visited.has(userId) || visited.size >= 10) return null;
      const userDelegations = delegationMap.get(userId);
      if (!userDelegations) return null;
      const next = userDelegations.get(proposal.topic_id) ?? userDelegations.get(null);
      if (!next) return null;
      const visited2 = new Set(visited);
      visited2.add(userId);
      return resolveTerminalVoter(next, visited2);
    };

    // All delegators (people who delegated and didn't vote directly)
    const delegatorIds = new Set(delegations.map((d) => d.delegator_id));
    for (const delegatorId of delegatorIds) {
      if (directVoterIds.has(delegatorId)) continue;
      const terminal = resolveTerminalVoter(delegatorId, new Set([delegatorId]));
      if (terminal) {
        if (!carried.has(terminal)) carried.set(terminal, []);
        carried.get(terminal)!.push(delegatorId);
      }
    }

    if (carried.size === 0) return [];

    // Resolve names
    const allIds = new Set<string>([...carried.keys(), ...Array.from(carried.values()).flat()]);
    const users = await this.dataSource.getRepository(User).findBy(Array.from(allIds).map((id) => ({ id })));
    const nameMap = new Map(users.map((u) => [u.id, u.name]));

    return Array.from(carried.entries()).map(([voterId, delegatorIds]) => ({
      voter: { user_id: voterId, name: nameMap.get(voterId) ?? 'Unknown' },
      carrying: delegatorIds.map((id) => ({ user_id: id, name: nameMap.get(id) ?? 'Unknown' })),
    }));
  }

  async sendVoteReminder(proposalId: string, requesterId: string): Promise<{ count: number }> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    if (proposal.status !== 'open') throw new BadRequestException('Can only send reminders for open proposals');
    if (!(await this.canModerate(proposal.organisation_id, requesterId))) {
      throw new ForbiddenException('Only moderators can send vote reminders');
    }

    const members = await this.memberRepo.find({ where: { organisation_id: proposal.organisation_id, status: 'approved' as any } });
    const votes = await this.dataSource.getRepository(Vote).find({ where: { proposal_id: proposalId } });
    const votedUserIds = new Set(votes.map((v) => v.user_id));

    const nonVoters = members.filter((m) => !votedUserIds.has(m.user_id) && m.user_id !== requesterId);
    if (nonVoters.length === 0) return { count: 0 };

    await this.notifications.createMany(
      nonVoters.map((m) => ({
        userId: m.user_id,
        orgId: proposal.organisation_id,
        type: 'proposal.vote_reminder' as const,
        actorId: requesterId,
        targetType: 'proposal',
        targetId: proposalId,
        metadata: { proposalTitle: proposal.title },
      })),
    );

    return { count: nonVoters.length };
  }

  async listLinks(proposalId: string): Promise<Array<{ id: string; link_type: string; direction: 'outgoing' | 'incoming'; other_proposal_id: string; other_proposal_title: string; other_proposal_status: string }>> {
    const repo = this.dataSource.getRepository(ProposalLink);
    const [outgoing, incoming] = await Promise.all([
      repo.find({ where: { source_proposal_id: proposalId } }),
      repo.find({ where: { target_proposal_id: proposalId } }),
    ]);

    const ids = [
      ...outgoing.map((l) => l.target_proposal_id),
      ...incoming.map((l) => l.source_proposal_id),
    ];
    const proposals = ids.length > 0
      ? await this.proposalRepo.findBy(ids.map((id) => ({ id })))
      : [];
    const propMap = new Map(proposals.map((p) => [p.id, p]));

    const INVERSE: Record<string, string> = {
      supersedes: 'superseded by',
      related_to: 'related to',
      blocks: 'blocked by',
      depends_on: 'depended on by',
    };

    return [
      ...outgoing.map((l) => ({
        id: l.id,
        link_type: l.link_type,
        direction: 'outgoing' as const,
        other_proposal_id: l.target_proposal_id,
        other_proposal_title: propMap.get(l.target_proposal_id)?.title ?? l.target_proposal_id,
        other_proposal_status: propMap.get(l.target_proposal_id)?.status ?? 'unknown',
      })),
      ...incoming.map((l) => ({
        id: l.id,
        link_type: INVERSE[l.link_type] ?? l.link_type,
        direction: 'incoming' as const,
        other_proposal_id: l.source_proposal_id,
        other_proposal_title: propMap.get(l.source_proposal_id)?.title ?? l.source_proposal_id,
        other_proposal_status: propMap.get(l.source_proposal_id)?.status ?? 'unknown',
      })),
    ];
  }

  async addLink(proposalId: string, userId: string, data: { target_proposal_id: string; link_type: ProposalLinkType }): Promise<ProposalLink> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    const target = await this.proposalRepo.findOneByOrFail({ id: data.target_proposal_id });
    if (proposal.organisation_id !== target.organisation_id) {
      throw new BadRequestException('Cannot link proposals from different organisations');
    }
    if (proposalId === data.target_proposal_id) {
      throw new BadRequestException('Cannot link a proposal to itself');
    }
    const repo = this.dataSource.getRepository(ProposalLink);
    const existing = await repo.findOneBy({ source_proposal_id: proposalId, target_proposal_id: data.target_proposal_id, link_type: data.link_type });
    if (existing) return existing;
    return repo.save(repo.create({ id: randomUUID(), source_proposal_id: proposalId, target_proposal_id: data.target_proposal_id, link_type: data.link_type, organisation_id: proposal.organisation_id, created_by: userId }));
  }

  async removeLink(linkId: string, userId: string): Promise<void> {
    const repo = this.dataSource.getRepository(ProposalLink);
    const link = await repo.findOneByOrFail({ id: linkId });
    const proposal = await this.proposalRepo.findOneByOrFail({ id: link.source_proposal_id });
    if (link.created_by !== userId && !(await this.canModerate(proposal.organisation_id, userId))) {
      throw new ForbiddenException('Only the link creator or moderators can remove links');
    }
    await repo.delete(linkId);
  }

  async listSignatures(proposalId: string): Promise<{ signatures: ProposalSignature[]; count: number }> {
    const signatures = await this.dataSource.getRepository(ProposalSignature).find({
      where: { proposal_id: proposalId },
      order: { created_at: 'ASC' },
    });
    return { signatures, count: signatures.length };
  }

  async sign(proposalId: string, userId: string): Promise<{ signed: boolean; count: number; transitioned: boolean }> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    if (proposal.proposal_type !== 'petition') throw new BadRequestException('This proposal is not in petition mode');
    if (proposal.status !== 'open') throw new BadRequestException('This proposal is not open for signatures');

    const repo = this.dataSource.getRepository(ProposalSignature);
    const existing = await repo.findOneBy({ proposal_id: proposalId, user_id: userId });
    if (existing) return { signed: false, count: await repo.count({ where: { proposal_id: proposalId } }), transitioned: false };

    await repo.save(repo.create({ id: randomUUID(), proposal_id: proposalId, organisation_id: proposal.organisation_id, user_id: userId }));
    const count = await repo.count({ where: { proposal_id: proposalId } });

    let transitioned = false;
    if (proposal.signature_threshold != null && count >= proposal.signature_threshold) {
      await this.proposalRepo.update(proposalId, { proposal_type: 'standard' as any });
      transitioned = true;
      try {
        await this.notifyOrgMembers(proposal.organisation_id, null, {
          type: 'proposal.opened',
          targetType: 'proposal',
          targetId: proposalId,
          metadata: { title: proposal.title, petitionTransition: true },
        });
      } catch { /* non-critical */ }
    }

    return { signed: true, count, transitioned };
  }

  async unsign(proposalId: string, userId: string): Promise<{ count: number }> {
    const repo = this.dataSource.getRepository(ProposalSignature);
    await repo.delete({ proposal_id: proposalId, user_id: userId });
    const count = await repo.count({ where: { proposal_id: proposalId } });
    return { count };
  }

  async watchProposal(proposalId: string, userId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO proposal_watches (proposal_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [proposalId, userId],
    );
  }

  async unwatchProposal(proposalId: string, userId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM proposal_watches WHERE proposal_id = $1 AND user_id = $2`,
      [proposalId, userId],
    );
  }

  async isWatching(proposalId: string, userId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM proposal_watches WHERE proposal_id = $1 AND user_id = $2) AS exists`,
      [proposalId, userId],
    );
    return rows[0]?.exists ?? false;
  }

  async getWatcherIds(proposalId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ user_id: string }[]>(
      `SELECT user_id FROM proposal_watches WHERE proposal_id = $1`,
      [proposalId],
    );
    return rows.map((r) => r.user_id);
  }

  async getVoteReceipt(proposalId: string, userId: string): Promise<object> {
    const proposal = await this.proposalRepo.findOneByOrFail({ id: proposalId });
    if (proposal.anonymous_voting) {
      throw new ForbiddenException('Vote receipts are not available for anonymous voting proposals');
    }
    const voteRepo = this.dataSource.getRepository(Vote);
    const votes = await voteRepo.findBy({ proposal_id: proposalId, user_id: userId });
    if (votes.length === 0) throw new NotFoundException('No vote found for this proposal');

    const receipt: Record<string, unknown> = {
      version: 1,
      proposal_id: proposalId,
      proposal_title: proposal.title,
      user_id: userId,
      org_id: proposal.organisation_id,
      votes: votes.map((v) => ({ choice: v.choice, option_id: v.option_id, reason: v.reason, voted_at: v.created_at })),
      issued_at: new Date().toISOString(),
    };

    const secret = process.env.RECEIPT_SECRET ?? 'ripple-receipt-insecure';
    const body = JSON.stringify(receipt);
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    return { ...receipt, signature: `sha256=${sig}` };
  }

  async getBoosts(proposalId: string): Promise<{ total: number; user_amount: number | null; boosts: ProposalBoost[] }> {
    const boosts = await this.boostRepo.find({ where: { proposal_id: proposalId }, order: { created_at: 'DESC' } });
    const total = boosts.reduce((sum, b) => sum + b.amount, 0);
    return { total, user_amount: null, boosts };
  }

  async getBoostsForUser(proposalId: string, userId: string): Promise<{ total: number; user_amount: number | null; boosts: ProposalBoost[] }> {
    const boosts = await this.boostRepo.find({ where: { proposal_id: proposalId }, order: { created_at: 'DESC' } });
    const total = boosts.reduce((sum, b) => sum + b.amount, 0);
    const user_amount = boosts.find((b) => b.user_id === userId)?.amount ?? null;
    return { total, user_amount, boosts };
  }

  async boost(proposalId: string, userId: string, amount: number): Promise<{ total: number }> {
    if (amount < 1 || amount > 100) throw new BadRequestException('Boost amount must be between 1 and 100');
    const proposal = await this.proposalRepo.findOneBy({ id: proposalId });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status !== 'draft' && proposal.status !== 'open') {
      throw new BadRequestException('Can only boost draft or open proposals');
    }

    const existing = await this.boostRepo.findOneBy({ proposal_id: proposalId, user_id: userId });
    if (existing) {
      await this.boostRepo.update({ id: existing.id }, { amount });
    } else {
      await this.boostRepo.save(this.boostRepo.create({ id: randomUUID(), proposal_id: proposalId, user_id: userId, amount }));
    }

    const boosts = await this.boostRepo.find({ where: { proposal_id: proposalId } });
    const total = boosts.reduce((sum, b) => sum + b.amount, 0);

    // Auto-promote draft to open if org has a boost_threshold and it's now met
    if (proposal.status === 'draft') {
      const org = await this.orgRepo.findOneBy({ id: proposal.organisation_id });
      if (org?.boost_threshold && total >= org.boost_threshold) {
        await this.proposalRepo.update({ id: proposalId }, { status: 'open' as ProposalStatus });
        this.auditLog.log(proposal.organisation_id, userId, 'proposal.boost_promoted', 'proposal', proposalId, { total_boosts: total, threshold: org.boost_threshold });
      }
    }

    return { total };
  }

  async unboost(proposalId: string, userId: string): Promise<{ total: number }> {
    await this.boostRepo.delete({ proposal_id: proposalId, user_id: userId });
    const boosts = await this.boostRepo.find({ where: { proposal_id: proposalId } });
    const total = boosts.reduce((sum, b) => sum + b.amount, 0);
    return { total };
  }

  async getPredictions(proposalId: string, userId: string | null): Promise<{
    pass_count: number;
    fail_count: number;
    pass_confidence: number;
    fail_confidence: number;
    user_prediction: Prediction | null;
  }> {
    const predictions = await this.predictionRepo.find({ where: { proposal_id: proposalId } });
    const pass = predictions.filter((p) => p.prediction === 'pass');
    const fail = predictions.filter((p) => p.prediction === 'fail');
    const avg = (arr: Prediction[]) => arr.length ? Math.round(arr.reduce((s, p) => s + p.confidence, 0) / arr.length) : 0;
    const user_prediction = userId ? (predictions.find((p) => p.user_id === userId) ?? null) : null;
    return {
      pass_count: pass.length,
      fail_count: fail.length,
      pass_confidence: avg(pass),
      fail_confidence: avg(fail),
      user_prediction,
    };
  }

  async predict(proposalId: string, userId: string, prediction: 'pass' | 'fail', confidence: number): Promise<Prediction> {
    if (confidence < 1 || confidence > 100) throw new BadRequestException('Confidence must be between 1 and 100');
    const proposal = await this.proposalRepo.findOneBy({ id: proposalId });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status === 'closed') throw new BadRequestException('Cannot predict on a closed proposal');

    const existing = await this.predictionRepo.findOneBy({ proposal_id: proposalId, user_id: userId });
    if (existing) {
      await this.predictionRepo.update({ id: existing.id }, { prediction, confidence });
      return this.predictionRepo.findOneByOrFail({ id: existing.id });
    }
    const entity = this.predictionRepo.create({ id: randomUUID(), proposal_id: proposalId, user_id: userId, prediction, confidence });
    return this.predictionRepo.save(entity);
  }

  async unpredict(proposalId: string, userId: string): Promise<void> {
    await this.predictionRepo.delete({ proposal_id: proposalId, user_id: userId });
  }
}
