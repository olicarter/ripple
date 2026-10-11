import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Vote, VoteChoice } from './vote.entity';
import { Proposal } from '../proposals/proposal.entity';
import { Organisation } from '../organisations/organisation.entity';
import { Delegation } from '../delegations/delegation.entity';
import { DelegationsService } from '../delegations/delegations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class VotesService {
  constructor(
    @InjectRepository(Vote)
    private readonly voteRepo: Repository<Vote>,
    @InjectRepository(Proposal)
    private readonly proposalRepo: Repository<Proposal>,
    @InjectRepository(Delegation)
    private readonly delegationRepo: Repository<Delegation>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  findOne(id: string): Promise<Vote | null> {
    return this.voteRepo.findOneBy({ id });
  }

  async findByProposal(proposalId: string): Promise<Vote[]> {
    const proposal = await this.proposalRepo.findOneBy({ id: proposalId });
    if (proposal?.status === 'open') {
      const org = await this.dataSource.getRepository(Organisation).findOneBy({ id: proposal.organisation_id });
      if (org?.voting_visibility === 'hidden') return [];
    }
    const votes = await this.voteRepo.findBy({ proposal_id: proposalId });
    if (proposal?.anonymous_voting) {
      return votes.map((v) => ({ ...v, user_id: null as unknown as string }));
    }
    return votes;
  }

  async create(data: {
    id: string;
    proposal_id: string;
    user_id: string;
    choice?: VoteChoice | null;
    option_id?: string | null;
    reason?: string | null;
    vote_count?: number;
  }): Promise<{ item: Vote; txid: number }> {
    const proposal = await this.proposalRepo.findOneBy({ id: data.proposal_id });
    if (!proposal || proposal.status !== 'open') {
      throw new BadRequestException('Voting is closed for this proposal');
    }
    if (proposal.deliberation_ends_at && new Date(proposal.deliberation_ends_at) > new Date()) {
      throw new BadRequestException('This proposal is in the deliberation phase — voting opens after deliberation ends');
    }
    const optionBasedTypes = ['multiple_choice', 'approval', 'score_voting', 'ranked_choice'];
    if (optionBasedTypes.includes(proposal.proposal_type)) {
      if (!data.option_id) throw new BadRequestException('option_id is required for this proposal type');
    } else {
      if (!data.choice) throw new BadRequestException('choice is required');
    }

    const voteCount = Math.max(1, Math.min(10, data.vote_count ?? 1));
    const creditCost = voteCount * voteCount;

    if ((proposal as any).quadratic_voting && voteCount > 1) {
      const [membership] = await this.dataSource.query(
        `SELECT credits_balance FROM memberships WHERE organisation_id = $1 AND user_id = $2`,
        [proposal.organisation_id, data.user_id],
      );
      const balance = membership?.credits_balance ?? null;
      if (balance === null) throw new BadRequestException('Credits not allocated for this period');
      if (balance < creditCost) throw new BadRequestException(`Insufficient credits: need ${creditCost}, have ${balance}`);
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const vote = manager.create(Vote, {
        id: data.id,
        proposal_id: data.proposal_id,
        user_id: data.user_id,
        choice: data.choice ?? null,
        option_id: data.option_id ?? null,
        reason: data.reason ?? null,
        organisation_id: proposal.organisation_id,
        vote_count: voteCount,
      });
      const saved = await manager.save(vote);
      if ((proposal as any).quadratic_voting && voteCount > 1) {
        await manager.query(
          `UPDATE memberships SET credits_balance = credits_balance - $1 WHERE organisation_id = $2 AND user_id = $3`,
          [creditCost, proposal.organisation_id, data.user_id],
        );
      }
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item: saved, txid: parseInt(row.txid, 10) };
    });

    if (proposal.proposal_type !== 'multiple_choice') {
      await this.notifyDelegators(data.user_id, proposal, data.choice!);
    }

    try {
      await this.dataSource.query(
        `INSERT INTO proposal_watches (proposal_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [data.proposal_id, data.user_id],
      );
    } catch { /* non-critical */ }

    if (!proposal.anonymous_voting) {
      this.webhooks.dispatch(proposal.organisation_id, 'vote.cast', {
        proposal_id: data.proposal_id,
        user_id: data.user_id,
        choice: data.choice ?? null,
      }).catch(() => {});
    }

    return result;
  }

  private async notifyDelegators(voterId: string, proposal: Proposal, choice: string): Promise<void> {
    try {
      const delegations = await this.delegationRepo.find({
        where: { organisation_id: proposal.organisation_id, delegate_id: voterId },
      });
      const active = DelegationsService.activeDelegations(delegations);
      const topicFiltered = active.filter(
        (d) => d.topic_id === null || d.topic_id === proposal.topic_id,
      );
      if (topicFiltered.length === 0) return;
      await this.notifications.createMany(
        topicFiltered.map((d) => ({
          userId: d.delegator_id,
          orgId: proposal.organisation_id,
          type: 'delegate.voted' as const,
          actorId: voterId,
          targetType: 'proposal',
          targetId: proposal.id,
          metadata: { choice, proposalTitle: proposal.title },
        })),
      );
    } catch { /* non-critical */ }
  }

  async update(id: string, data: { choice?: VoteChoice | null; option_id?: string | null; reason?: string | null }): Promise<{ item: Vote; txid: number }> {
    const vote = await this.voteRepo.findOneBy({ id });
    if (vote) {
      const proposal = await this.proposalRepo.findOneBy({ id: vote.proposal_id });
      if (!proposal || proposal.status !== 'open') {
        throw new BadRequestException('Voting is closed for this proposal');
      }
      if (proposal.deliberation_ends_at && new Date(proposal.deliberation_ends_at) > new Date()) {
        throw new BadRequestException('This proposal is in the deliberation phase — voting opens after deliberation ends');
      }
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.update(Vote, id, data);
      const item = await manager.findOneByOrFail(Vote, { id });
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item, txid: parseInt(row.txid, 10) };
    });
  }

  async delete(id: string): Promise<{ txid: number }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(Vote, id);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
  }

  async setScores(proposalId: string, userId: string, scores: Array<{ option_id: string; score: number }>): Promise<{ txid: number }> {
    const proposal = await this.proposalRepo.findOneBy({ id: proposalId });
    if (!proposal || proposal.status !== 'open') throw new BadRequestException('Voting is closed');
    if (proposal.proposal_type !== 'score_voting') throw new BadRequestException('Not a score voting proposal');

    return this.dataSource.transaction(async (manager) => {
      await manager.delete(Vote, { proposal_id: proposalId, user_id: userId });
      if (scores.length > 0) {
        const votes = scores.map(({ option_id, score }) =>
          manager.create(Vote, {
            id: `${userId}-${proposalId}-${option_id}`,
            proposal_id: proposalId, user_id: userId,
            organisation_id: proposal.organisation_id,
            choice: null, option_id, score: Math.min(5, Math.max(0, score)), reason: null, rank_position: null,
          }),
        );
        await manager.save(votes);
      }
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
  }

  async setRankings(proposalId: string, userId: string, optionIds: string[]): Promise<{ txid: number }> {
    const proposal = await this.proposalRepo.findOneBy({ id: proposalId });
    if (!proposal || proposal.status !== 'open') throw new BadRequestException('Voting is closed');
    if (proposal.proposal_type !== 'ranked_choice') throw new BadRequestException('Not a ranked choice proposal');

    return this.dataSource.transaction(async (manager) => {
      await manager.delete(Vote, { proposal_id: proposalId, user_id: userId });
      if (optionIds.length > 0) {
        const votes = optionIds.map((option_id, i) =>
          manager.create(Vote, {
            id: `${userId}-${proposalId}-${option_id}`,
            proposal_id: proposalId, user_id: userId,
            organisation_id: proposal.organisation_id,
            choice: null, option_id, rank_position: i + 1, score: null, reason: null,
          }),
        );
        await manager.save(votes);
      }
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  async setApprovals(proposalId: string, userId: string, optionIds: string[]): Promise<{ txid: number }> {
    const proposal = await this.proposalRepo.findOneBy({ id: proposalId });
    if (!proposal || proposal.status !== 'open') throw new BadRequestException('Voting is closed');
    if (proposal.proposal_type !== 'approval') throw new BadRequestException('Not an approval proposal');

    return this.dataSource.transaction(async (manager) => {
      await manager.delete(Vote, { proposal_id: proposalId, user_id: userId });
      if (optionIds.length > 0) {
        const votes = optionIds.map((optionId) =>
          manager.create(Vote, {
            id: `${userId}-${proposalId}-${optionId}`,
            proposal_id: proposalId,
            user_id: userId,
            organisation_id: proposal.organisation_id,
            choice: null,
            option_id: optionId,
            reason: null,
          }),
        );
        await manager.save(votes);
      }
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
  }
}
