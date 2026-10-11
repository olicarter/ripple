import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Delegation } from './delegation.entity';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_DELEGATION_DEPTH = 10;

@Injectable()
export class DelegationsService {
  constructor(
    @InjectRepository(Delegation)
    private readonly delegationRepo: Repository<Delegation>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  findOne(id: string): Promise<Delegation | null> {
    return this.delegationRepo.findOneBy({ id });
  }

  async topicBelongsToOrg(topicId: string, orgId: string): Promise<boolean> {
    const [row] = await this.dataSource.query(`SELECT 1 FROM topics WHERE id = $1 AND organisation_id = $2`, [topicId, orgId]);
    return !!row;
  }

  findAll(): Promise<Delegation[]> {
    return this.delegationRepo.find({ order: { created_at: 'ASC' } });
  }

  findByOrg(organisationId: string): Promise<Delegation[]> {
    return this.delegationRepo.find({ where: { organisation_id: organisationId }, order: { created_at: 'ASC' } });
  }

  findByDelegator(delegatorId: string): Promise<Delegation[]> {
    return this.delegationRepo.findBy({ delegator_id: delegatorId });
  }

  static activeDelegations(delegations: Delegation[]): Delegation[] {
    const now = new Date();
    return delegations.filter((d) => !d.expires_at || d.expires_at > now);
  }

  private wouldCreateCycle(
    delegatorId: string,
    delegateId: string,
    existing: Delegation[],
  ): boolean {
    // Build adjacency list across active delegations only
    const graph = new Map<string, string[]>();
    for (const d of DelegationsService.activeDelegations(existing)) {
      if (!graph.has(d.delegator_id)) graph.set(d.delegator_id, []);
      graph.get(d.delegator_id)!.push(d.delegate_id);
    }

    // BFS from delegateId — if we reach delegatorId, adding this edge creates a cycle
    const visited = new Set<string>();
    const queue = [delegateId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === delegatorId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      if (visited.size > MAX_DELEGATION_DEPTH) break;
      for (const next of graph.get(current) ?? []) queue.push(next);
    }
    return false;
  }

  async create(data: {
    id: string;
    organisation_id: string;
    delegator_id: string;
    delegate_id: string;
    topic_id?: string | null;
    expires_at?: string | null;
    fallback_abstain_hours?: number | null;
    weight_fraction?: number | null;
  }): Promise<{ item: Delegation; txid: number }> {
    if (data.delegator_id === data.delegate_id) {
      throw new BadRequestException('You cannot delegate to yourself');
    }

    const fraction = data.weight_fraction ?? 1;
    if (fraction <= 0 || fraction > 1) {
      throw new BadRequestException('weight_fraction must be between 0 (exclusive) and 1 (inclusive)');
    }

    const existing = await this.delegationRepo.find({ where: { organisation_id: data.organisation_id } });
    if (this.wouldCreateCycle(data.delegator_id, data.delegate_id, existing)) {
      throw new BadRequestException('This delegation would create a circular chain');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const delegation = manager.create(Delegation, {
        topic_id: null,
        fallback_abstain_hours: null,
        ...data,
        weight_fraction: data.weight_fraction ?? 1,
        expires_at: data.expires_at ? new Date(data.expires_at) : null,
      });
      const saved = await manager.save(delegation);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { item: saved, txid: parseInt(row.txid, 10) };
    });

    try {
      await this.dataSource.query(
        `INSERT INTO delegation_history (organisation_id, delegator_id, delegate_id, topic_id, event) VALUES ($1,$2,$3,$4,'added')`,
        [data.organisation_id, data.delegator_id, data.delegate_id, data.topic_id ?? null],
      );
    } catch { /* non-critical */ }

    try {
      await this.notifications.create({
        userId: data.delegate_id,
        orgId: data.organisation_id,
        type: 'delegation.added',
        actorId: data.delegator_id,
        targetType: 'delegation',
        targetId: result.item.id,
        metadata: {},
      });
    } catch { /* non-critical */ }

    return result;
  }

  async delete(id: string): Promise<{ txid: number }> {
    const delegation = await this.delegationRepo.findOneBy({ id });
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.delete(Delegation, id);
      const [row] = await manager.query(`SELECT pg_current_xact_id()::text AS txid`);
      return { txid: parseInt(row.txid, 10) };
    });
    if (delegation) {
      try {
        await this.dataSource.query(
          `INSERT INTO delegation_history (organisation_id, delegator_id, delegate_id, topic_id, event) VALUES ($1,$2,$3,$4,'removed')`,
          [delegation.organisation_id, delegation.delegator_id, delegation.delegate_id, delegation.topic_id ?? null],
        );
      } catch { /* non-critical */ }

      try {
        await this.notifications.create({
          userId: delegation.delegate_id,
          orgId: delegation.organisation_id,
          type: 'delegation.removed',
          actorId: delegation.delegator_id,
          targetType: 'delegation',
          targetId: id,
          metadata: {},
        });
      } catch { /* non-critical */ }
    }
    return result;
  }

  async getHistory(userId: string): Promise<Array<{
    id: string; event: string; organisation_id: string; delegator_id: string; delegate_id: string;
    topic_id: string | null; created_at: string;
    delegator_name: string; delegate_name: string;
  }>> {
    const rows = await this.dataSource.query<Array<{
      id: string; event: string; organisation_id: string; delegator_id: string; delegate_id: string;
      topic_id: string | null; created_at: string; delegator_name: string; delegate_name: string;
    }>>(
      `SELECT dh.id, dh.event, dh.organisation_id, dh.delegator_id, dh.delegate_id, dh.topic_id, dh.created_at,
              u1.name AS delegator_name, u2.name AS delegate_name
       FROM delegation_history dh
       JOIN users u1 ON u1.id = dh.delegator_id
       JOIN users u2 ON u2.id = dh.delegate_id
       WHERE dh.delegator_id = $1 OR dh.delegate_id = $1
       ORDER BY dh.created_at DESC
       LIMIT 200`,
      [userId],
    );
    return rows;
  }
}
