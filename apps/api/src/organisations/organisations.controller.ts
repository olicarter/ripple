import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { OrganisationsService } from './organisations.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import type { MemberRole } from './membership.entity';
import type { Organisation } from './organisation.entity';

// Columns only admins may read (via GET :slug/admin-settings). Also excluded from
// the Electric organisations shape — see electric/shape-policy.ts.
const SECRET_ORG_FIELDS = [
  'invite_token', 'stripe_customer_id', 'stripe_subscription_id', 'slack_bot_token',
  'oidc_client_secret', 'scim_token', 'discord_webhook_url',
] as const;

function toPublicOrg(org: Organisation): Omit<Organisation, (typeof SECRET_ORG_FIELDS)[number]> {
  const copy: Partial<Organisation> = { ...org };
  for (const field of SECRET_ORG_FIELDS) delete copy[field];
  return copy as Omit<Organisation, (typeof SECRET_ORG_FIELDS)[number]>;
}

@Controller('orgs')
export class OrganisationsController {
  constructor(
    private readonly orgsService: OrganisationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  async listForUser(@Req() req: AuthenticatedRequest) {
    return (await this.orgsService.findForUser(req.user!.id)).map(toPublicOrg);
  }

  @Post()
  @UseGuards(AuthGuard)
  create(
    @Body() body: { name: string; slug?: string; description?: string; org_type?: string; features?: Record<string, boolean> },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.create(body, req.user!.id);
  }

  @Get('stats')
  getStats() {
    return this.orgsService.getStats();
  }

  @Get(':slug/analytics')
  @UseGuards(AuthGuard)
  getAnalytics(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.getAnalytics(slug, req.user!.id);
  }

  @Get(':slug/decisions')
  @UseGuards(AuthGuard)
  getDecisionRecord(
    @Param('slug') slug: string,
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orgsService.getDecisionRecord(
      slug,
      req.user!.id,
      page ? parseInt(page, 10) : 1,
      pageSize ? Math.min(parseInt(pageSize, 10), 100) : 25,
    );
  }

  @Get(':slug/decisions/export')
  @UseGuards(AuthGuard)
  async exportDecisionRecord(@Param('slug') slug: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const csv = await this.orgsService.exportDecisionRecordCsv(slug, req.user!.id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="decisions-${slug}.csv"`);
    res.send(csv);
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    return toPublicOrg(await this.orgsService.findBySlug(slug));
  }

  @Get(':slug/admin-settings')
  @UseGuards(AuthGuard)
  getAdminSettings(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.getAdminSettings(slug, req.user!.id);
  }

  @Patch(':slug')
  @UseGuards(AuthGuard)
  update(
    @Param('slug') slug: string,
    @Body() body: { name?: string; description?: string; proposal_creation_role?: 'member' | 'moderator' | 'admin'; topic_creation_role?: 'member' | 'moderator' | 'admin'; default_voting_duration_days?: number | null; default_threshold?: number; voting_visibility?: 'public' | 'hidden'; default_quorum?: number | null; is_public?: boolean; veto_role?: 'moderator' | 'admin'; min_endorsements?: number; require_member_approval?: boolean; weight_mode?: 'manual' | 'by_role'; proposal_templates?: Array<{ id: string; name: string; description: string; proposal_type: 'standard' | 'discussion' | 'multiple_choice'; threshold: number }>; allowed_email_domains?: string[]; primary_color?: string | null; logo_url?: string | null; data_retention_months?: number | null; discord_webhook_url?: string | null; quadratic_credits?: number | null; credit_period_days?: number | null; email_from_name?: string | null; email_from_address?: string | null; boost_threshold?: number | null; oidc_issuer?: string | null; oidc_client_id?: string | null; oidc_client_secret?: string | null; sso_required?: boolean; org_type?: string; features?: Record<string, boolean> },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.update(slug, body, req.user!.id);
  }

  @Post(':slug/nonprofit')
  @UseGuards(AuthGuard)
  applyNonprofit(
    @Param('slug') slug: string,
    @Body() body: { nonprofit_name: string; nonprofit_registration_number?: string; nonprofit_country?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.applyNonprofit(slug, req.user!.id, body);
  }

  @Delete(':slug')
  @UseGuards(AuthGuard)
  delete(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.delete(slug, req.user!.id);
  }

  // --- Members ---

  @Get(':slug/members')
  async listMembers(@Param('slug') slug: string) {
    const org = await this.orgsService.findBySlug(slug);
    return this.orgsService.listMembers(org.id);
  }

  @Get(':slug/members/search')
  @UseGuards(AuthGuard)
  searchMembers(@Param('slug') slug: string, @Query('q') q = '') {
    return this.orgsService.searchMembers(slug, q);
  }

  @Post(':slug/members')
  @UseGuards(AuthGuard)
  async addMember(
    @Param('slug') slug: string,
    @Body() body: { user_id: string; role?: MemberRole },
    @Req() req: AuthenticatedRequest,
  ) {
    const org = await this.orgsService.findBySlug(slug);
    return this.orgsService.addMember(org.id, body.user_id, body.role ?? 'member', req.user!.id);
  }

  @Patch(':slug/members/:userId')
  @UseGuards(AuthGuard)
  async updateMemberRole(
    @Param('slug') slug: string,
    @Param('userId') userId: string,
    @Body() body: { role?: MemberRole; weight?: number },
    @Req() req: AuthenticatedRequest,
  ) {
    const org = await this.orgsService.findBySlug(slug);
    if (body.role !== undefined) {
      return this.orgsService.updateMemberRole(org.id, userId, body.role, req.user!.id);
    }
    if (body.weight !== undefined) {
      return this.orgsService.updateMemberWeight(org.id, userId, body.weight, req.user!.id);
    }
    return {};
  }

  @Delete(':slug/members/:userId')
  @UseGuards(AuthGuard)
  async removeMember(
    @Param('slug') slug: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const org = await this.orgsService.findBySlug(slug);
    return this.orgsService.removeMember(org.id, userId, req.user!.id);
  }

  @Post(':slug/join')
  @UseGuards(AuthGuard)
  async join(
    @Param('slug') slug: string,
    @Body() body: { token?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (body.token) {
      return this.orgsService.joinViaToken(slug, req.user!.id, body.token);
    }
    return this.orgsService.joinPublic(slug, req.user!.id);
  }

  @Post(':slug/members/:userId/approve')
  @UseGuards(AuthGuard)
  async approveMember(
    @Param('slug') slug: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.approveMember(slug, userId, req.user!.id);
  }

  @Post(':slug/members/:userId/reject')
  @UseGuards(AuthGuard)
  async rejectMember(
    @Param('slug') slug: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.rejectMember(slug, userId, req.user!.id);
  }

  @Post(':slug/transfer-ownership')
  @UseGuards(AuthGuard)
  transferOwnership(
    @Param('slug') slug: string,
    @Body() body: { to_user_id: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.transferOwnership(slug, body.to_user_id, req.user!.id);
  }

  @Post(':slug/invite-token')
  @UseGuards(AuthGuard)
  generateInviteToken(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.generateInviteToken(slug, req.user!.id);
  }

  @Delete(':slug/invite-token')
  @UseGuards(AuthGuard)
  revokeInviteToken(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.revokeInviteToken(slug, req.user!.id);
  }

  @Post(':slug/scim-token')
  @UseGuards(AuthGuard)
  generateScimToken(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.generateScimToken(slug, req.user!.id);
  }

  @Delete(':slug/scim-token')
  @UseGuards(AuthGuard)
  revokeScimToken(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.revokeScimToken(slug, req.user!.id);
  }

  @Patch(':slug/custom-domain')
  @UseGuards(AuthGuard)
  setCustomDomain(
    @Param('slug') slug: string,
    @Body() body: { domain: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.setCustomDomain(slug, body.domain ?? null, req.user!.id);
  }

  @Post(':slug/custom-domain/verify')
  @UseGuards(AuthGuard)
  verifyCustomDomain(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.verifyCustomDomain(slug, req.user!.id);
  }

  @Get(':slug/audit-log')
  @UseGuards(AuthGuard)
  async getAuditLog(
    @Param('slug') slug: string,
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const org = await this.orgsService.findBySlug(slug);
    await this.orgsService.requireRole(org.id, req.user!.id, ['admin']);
    return this.auditLog.list(
      org.id,
      page ? parseInt(page, 10) : 1,
      pageSize ? Math.min(parseInt(pageSize, 10), 100) : 50,
    );
  }

  @Get(':slug/audit-log/export')
  @UseGuards(AuthGuard)
  async exportAuditLog(@Param('slug') slug: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const org = await this.orgsService.findBySlug(slug);
    await this.orgsService.requireRole(org.id, req.user!.id, ['admin']);
    const csv = await this.auditLog.exportCsv(org.id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-audit-log.csv"`);
    res.send(csv);
  }

  @Post(':slug/credits/allocate')
  @UseGuards(AuthGuard)
  allocateCredits(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.allocateCredits(slug, req.user!.id);
  }

  @Get(':slug/proposals/snapshot')
  @UseGuards(AuthGuard)
  exportSnapshot(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.exportSnapshotFormat(slug, req.user!.id);
  }

  @Get(':slug/results')
  async getPublicResults(@Param('slug') slug: string) {
    return this.orgsService.getPublicResults(slug);
  }

  // --- Email invites ---

  @Get(':slug/invites')
  @UseGuards(AuthGuard)
  listInvites(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.listPendingInvites(slug, req.user!.id);
  }

  @Post(':slug/invites')
  @UseGuards(AuthGuard)
  sendInvite(
    @Param('slug') slug: string,
    @Body() body: { email: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.inviteByEmail(slug, body.email, req.user!.id);
  }

  @Delete(':slug/invites/:inviteId')
  @UseGuards(AuthGuard)
  cancelInvite(
    @Param('slug') slug: string,
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.cancelInvite(slug, inviteId, req.user!.id);
  }

  // --- Accept email invite (token-based, no org slug needed) ---

  @Get('invites/accept')
  getInviteInfo(@Query('token') token: string) {
    return this.orgsService.getInviteInfo(token);
  }

  @Post('invites/accept')
  @UseGuards(AuthGuard)
  acceptInvite(@Query('token') token: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.acceptEmailInvite(token, req.user!.id);
  }

  @Get(':slug/delegation-weights')
  @UseGuards(AuthGuard)
  getDelegationWeights(@Param('slug') slug: string) {
    return this.orgsService.getDelegationWeights(slug);
  }

  @Get('unsubscribe')
  unsubscribe(@Query('token') token: string) {
    return this.orgsService.unsubscribeByToken(token);
  }

  @Get(':slug/email-preferences')
  @UseGuards(AuthGuard)
  getEmailPreferences(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.getEmailPreferences(slug, req.user!.id);
  }

  @Patch(':slug/email-preferences')
  @UseGuards(AuthGuard)
  updateEmailPreferences(
    @Param('slug') slug: string,
    @Body() body: { email_notifications_enabled?: boolean; email_digest_enabled?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.orgsService.updateEmailPreferences(slug, req.user!.id, body);
  }

  @Post(':slug/send-digest')
  @UseGuards(AuthGuard)
  sendDigest(@Param('slug') slug: string, @Req() req: AuthenticatedRequest) {
    return this.orgsService.sendDigest(slug, req.user!.id);
  }

  @Get(':slug/calendar.ics')
  @UseGuards(AuthGuard)
  async getCalendar(
    @Param('slug') slug: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const ics = await this.orgsService.getCalendarIcs(slug, req.user!.id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-proposals.ics"`);
    res.send(ics);
  }

  @Get(':slug/export')
  @UseGuards(AuthGuard)
  async exportOrgData(
    @Param('slug') slug: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const data = await this.orgsService.exportOrgData(slug, req.user!.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-export.json"`);
    res.send(JSON.stringify(data, null, 2));
  }
}
