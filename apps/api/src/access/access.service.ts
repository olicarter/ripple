import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const ROLE_RANK: Record<string, number> = { observer: 0, member: 1, moderator: 2, admin: 3 };

export type OrgRole = 'observer' | 'member' | 'moderator' | 'admin';

interface ProposalAccessRow {
  id: string;
  organisation_id: string;
  author_id: string | null;
  status: string;
}

/**
 * Shared read/write authorisation rules, so controllers don't each re-derive them:
 * - An org's content is visible to everyone if the org is public, otherwise to its
 *   approved members.
 * - Draft proposals are visible to their author only.
 * - Acting in an org requires approved membership, optionally with a minimum role.
 * Electric shapes apply the same rules in electric/shape-policy.ts.
 */
@Injectable()
export class AccessService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async role(orgId: string, userId: string | null | undefined): Promise<OrgRole | null> {
    if (!userId) return null;
    const [row] = await this.dataSource.query<Array<{ role: OrgRole }>>(
      `SELECT role FROM memberships WHERE organisation_id = $1 AND user_id = $2 AND status = 'approved'`,
      [orgId, userId],
    );
    return row?.role ?? null;
  }

  async canViewOrg(orgId: string, userId: string | null | undefined): Promise<boolean> {
    const [org] = await this.dataSource.query<Array<{ is_public: boolean }>>(
      `SELECT is_public FROM organisations WHERE id = $1`,
      [orgId],
    );
    if (!org) return false;
    return org.is_public || (await this.role(orgId, userId)) !== null;
  }

  async assertCanViewOrg(orgId: string, userId: string | null | undefined): Promise<void> {
    if (!(await this.canViewOrg(orgId, userId))) {
      throw new ForbiddenException('You do not have access to this organisation');
    }
  }

  async assertCanViewOrgSlug(slug: string, userId: string | null | undefined): Promise<string> {
    const [org] = await this.dataSource.query<Array<{ id: string }>>(`SELECT id FROM organisations WHERE slug = $1`, [slug]);
    if (!org) throw new NotFoundException(`Organisation "${slug}" not found`);
    await this.assertCanViewOrg(org.id, userId);
    return org.id;
  }

  /** Throws unless the viewer may see the proposal; returns its access fields. */
  async assertCanViewProposal(proposalId: string, userId: string | null | undefined): Promise<ProposalAccessRow> {
    const [proposal] = await this.dataSource.query<ProposalAccessRow[]>(
      `SELECT id, organisation_id, author_id, status FROM proposals WHERE id = $1`,
      [proposalId],
    );
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status === 'draft' && proposal.author_id !== userId) {
      throw new NotFoundException('Proposal not found');
    }
    await this.assertCanViewOrg(proposal.organisation_id, userId);
    return proposal;
  }

  /** Throws unless userId is an approved member with at least minRole. */
  async assertRole(orgId: string, userId: string, minRole: OrgRole = 'member'): Promise<OrgRole> {
    const role = await this.role(orgId, userId);
    if (!role) throw new ForbiddenException('Not a member of this organisation');
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) throw new ForbiddenException(`Requires role: ${minRole} or above`);
    return role;
  }

  async assertRoleForSlug(slug: string, userId: string, minRole: OrgRole = 'member'): Promise<string> {
    const [org] = await this.dataSource.query<Array<{ id: string }>>(`SELECT id FROM organisations WHERE slug = $1`, [slug]);
    if (!org) throw new NotFoundException(`Organisation "${slug}" not found`);
    await this.assertRole(org.id, userId, minRole);
    return org.id;
  }

  /** Proposal that a comment belongs to. */
  async commentProposalId(commentId: string): Promise<string> {
    const [row] = await this.dataSource.query<Array<{ proposal_id: string }>>(
      `SELECT proposal_id FROM comments WHERE id = $1`,
      [commentId],
    );
    if (!row) throw new NotFoundException('Comment not found');
    return row.proposal_id;
  }

  /** Proposal visible to the user and the user an approved member of its org. */
  async assertCanActOnProposal(proposalId: string, userId: string): Promise<ProposalAccessRow> {
    const proposal = await this.assertCanViewProposal(proposalId, userId);
    await this.assertRole(proposal.organisation_id, userId);
    return proposal;
  }

  async proposalOrgId(proposalId: string): Promise<string> {
    const [row] = await this.dataSource.query<Array<{ organisation_id: string }>>(
      `SELECT organisation_id FROM proposals WHERE id = $1`,
      [proposalId],
    );
    if (!row) throw new NotFoundException('Proposal not found');
    return row.organisation_id;
  }
}
