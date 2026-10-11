import { randomBytes } from 'crypto';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SlackService } from './slack.service';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { Organisation } from '../organisations/organisation.entity';
import { Membership } from '../organisations/membership.entity';

@Controller('slack')
export class SlackController {
  constructor(
    private readonly slackService: SlackService,
    @InjectRepository(Organisation)
    private readonly orgRepo: Repository<Organisation>,
    @InjectRepository(Membership)
    private readonly memberRepo: Repository<Membership>,
  ) {}

  private async requireAdmin(orgId: string, userId: string): Promise<void> {
    const m = await this.memberRepo.findOneBy({ organisation_id: orgId, user_id: userId });
    if (m?.role !== 'admin') throw new ForbiddenException('Admin only');
  }

  @Get('connect/:orgSlug')
  @UseGuards(AuthGuard)
  async getConnectUrl(@Param('orgSlug') orgSlug: string, @Req() req: AuthenticatedRequest) {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) throw new BadRequestException('Slack not configured');
    const org = await this.orgRepo.findOneByOrFail({ slug: orgSlug });
    await this.requireAdmin(org.id, req.user!.id);
    const redirectUri = `${process.env.APP_URL ?? 'https://localhost:5173'}/api/slack/callback`;
    // Random state remembered in the admin's session, so the callback can only
    // connect the org this admin started connecting.
    const state = randomBytes(24).toString('base64url');
    req.session!.slackOAuth = { state, orgSlug };
    const scopes = 'chat:write,channels:read,groups:read,incoming-webhook';
    const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    return { url };
  }

  @Get('callback')
  async handleCallback(@Query('code') code: string, @Query('state') state: string, @Req() req: AuthenticatedRequest) {
    if (!code) throw new BadRequestException('Missing code');
    const pending = req.session?.slackOAuth;
    if (!pending || !state || pending.state !== state) throw new BadRequestException('Invalid state');
    delete req.session!.slackOAuth;
    const orgSlug = pending.orgSlug;

    const org = await this.orgRepo.findOneByOrFail({ slug: orgSlug });
    const userId = req.session?.userId;
    if (!userId) throw new BadRequestException('Not signed in');
    await this.requireAdmin(org.id, userId);
    const redirectUri = `${process.env.APP_URL ?? 'https://localhost:5173'}/api/slack/callback`;
    const data = await this.slackService.exchangeOAuthCode(code, redirectUri);

    await this.orgRepo.update(org.id, {
      slack_team_id: data.teamId,
      slack_team_name: data.teamName,
      slack_bot_token: data.botToken,
      slack_channel_id: data.channelId,
      slack_channel_name: data.channelName,
    });

    return `<html><script>window.location.href='/orgs/${orgSlug}/admin?slack=connected';</script></html>`;
  }

  @Get(':orgId/channels')
  @UseGuards(AuthGuard)
  async listChannels(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    await this.requireAdmin(orgId, req.user!.id);
    return this.slackService.listChannels(orgId);
  }

  @Post(':orgId/channel')
  @UseGuards(AuthGuard)
  async setChannel(
    @Param('orgId') orgId: string,
    @Body() body: { channel_id: string },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireAdmin(orgId, req.user!.id);
    await this.slackService.setChannel(orgId, body.channel_id);
    return { ok: true };
  }

  @Delete(':orgId/disconnect')
  @UseGuards(AuthGuard)
  async disconnect(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    await this.requireAdmin(orgId, req.user!.id);
    await this.slackService.disconnect(orgId);
    return { ok: true };
  }
}
