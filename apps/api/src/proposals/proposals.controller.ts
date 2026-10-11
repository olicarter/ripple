import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ProposalsService } from './proposals.service';
import { AuthGuard, OptionalAuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AccessService } from '../access/access.service';

@Controller('proposals')
export class ProposalsController {
  constructor(
    private readonly proposalsService: ProposalsService,
    private readonly access: AccessService,
  ) {}

  /** Reads: public orgs to everyone, private orgs to members, drafts to their author. */
  private view(id: string, req: AuthenticatedRequest) {
    return this.access.assertCanViewProposal(id, req.user?.id);
  }

  /** Writes: the proposal must be visible and the user an approved member of its org. */
  private async act(id: string, req: AuthenticatedRequest) {
    const proposal = await this.access.assertCanViewProposal(id, req.user!.id);
    await this.access.assertRole(proposal.organisation_id, req.user!.id);
    return proposal;
  }

  @Get()
  @UseGuards(OptionalAuthGuard)
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query('org') org?: string,
    @Query('organisation_id') organisationIdAlias?: string,
    @Query('status') status?: string,
    @Query('topic_id') topic_id?: string,
    @Query('author_id') author_id?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const organisation_id = org ?? organisationIdAlias;
    if (!organisation_id) throw new BadRequestException('The org query parameter is required');
    await this.access.assertCanViewOrg(organisation_id, req.user?.id);
    return this.proposalsService.findPaginated({
      organisation_id,
      status,
      topic_id,
      author_id,
      sort,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      viewerId: req.user?.id ?? null,
    });
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.findOne(id);
  }

  @Get(':id/tally')
  @UseGuards(OptionalAuthGuard)
  async tally(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.tally(id);
  }

  @Get(':id/embed')
  @UseGuards(OptionalAuthGuard)
  async embed(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getEmbedData(id);
  }

  @Get(':id/og-image')
  @UseGuards(OptionalAuthGuard)
  async ogImage(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.view(id, req);
    const svg = await this.proposalsService.getOgImage(id);
    if (!svg) { res.status(404).send('Not found'); return; }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  }

  @Get(':id/tally/csv')
  @UseGuards(AuthGuard)
  async tallyCsv(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.view(id, req);
    const csv = await this.proposalsService.exportVotesCsv(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="votes-${id}.csv"`);
    res.send(csv);
  }

  @Get(':id/my-delegation-vote')
  @UseGuards(AuthGuard)
  async myDelegationVote(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getMyDelegationVote(id, req.user!.id);
  }

  @Get(':id/my-delegation-chain')
  @UseGuards(AuthGuard)
  async myDelegationChain(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getMyDelegationChain(id, req.user!.id);
  }

  @Get(':id/versions')
  @UseGuards(OptionalAuthGuard)
  async listVersions(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.listVersions(id);
  }

  @Post('import')
  @UseGuards(AuthGuard)
  bulkImport(
    @Body() body: { org_slug: string; proposals: Array<{ title: string; description?: string; topic_id: string; closes_at?: string; status?: 'open' | 'draft'; tags?: string[] }> },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.proposalsService.bulkImport(body.org_slug, req.user!.id, body.proposals);
  }

  @Post()
  @UseGuards(AuthGuard)
  create(
    @Body() body: { id: string; organisation_id: string; topic_id: string; title: string; description?: string; closes_at?: string | null; opens_at?: string | null; deliberation_ends_at?: string | null; threshold?: number; quorum?: number | null; quorum_type?: 'soft' | 'hard'; status?: 'open' | 'draft'; proposal_type?: 'standard' | 'discussion' | 'multiple_choice' | 'temperature_check' | 'consent' | 'approval' | 'score_voting' | 'ranked_choice' | 'petition' | 'amendment'; tags?: string[]; impact_level?: 'low' | 'medium' | 'high' | 'constitutional' | null; signature_threshold?: number | null; parent_proposal_id?: string | null; amendment_text?: string | null; anonymous_voting?: boolean; conviction_voting?: boolean; quadratic_voting?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.proposalsService.create({ ...body, author_id: req.user!.id });
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  async edit(
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; tags?: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.act(id, req);
    return this.proposalsService.edit(id, req.user!.id, body);
  }

  @Post(':id/publish')
  @UseGuards(AuthGuard)
  async publish(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.publish(id, req.user!.id);
  }

  @Post(':id/close')
  @UseGuards(AuthGuard)
  async close(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.close(id, req.user!.id);
  }

  @Post(':id/reopen')
  @UseGuards(AuthGuard)
  async reopen(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.reopen(id, req.user!.id);
  }

  @Post(':id/withdraw')
  @UseGuards(AuthGuard)
  async withdraw(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.withdraw(id, req.user!.id);
  }

  @Post(':id/outcome')
  @UseGuards(AuthGuard)
  async setOutcome(
    @Param('id') id: string,
    @Body() body: { outcome: 'implemented' | 'not_implemented' | 'in_progress' | null },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.act(id, req);
    return this.proposalsService.setOutcome(id, req.user!.id, body.outcome);
  }

  @Post(':id/vote-reminder')
  @UseGuards(AuthGuard)
  async sendVoteReminder(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.sendVoteReminder(id, req.user!.id);
  }

  @Post(':id/pin')
  @UseGuards(AuthGuard)
  async pin(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.setPin(id, req.user!.id, true);
  }

  @Post(':id/unpin')
  @UseGuards(AuthGuard)
  async unpin(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.setPin(id, req.user!.id, false);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const proposal = await this.act(id, req);
    if (proposal.author_id !== req.user!.id) {
      await this.access.assertRole(proposal.organisation_id, req.user!.id, 'moderator')
        .catch(() => { throw new ForbiddenException('Only the author or a moderator can delete this proposal'); });
    }
    return this.proposalsService.delete(id);
  }

  @Get(':id/jury')
  @UseGuards(OptionalAuthGuard)
  async getJury(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getJury(id);
  }

  @Post(':id/jury')
  @UseGuards(AuthGuard)
  async selectJury(
    @Param('id') id: string,
    @Body() body: { size: number },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.act(id, req);
    return this.proposalsService.selectJury(id, req.user!.id, body.size);
  }

  @Get(':id/carrying')
  @UseGuards(OptionalAuthGuard)
  async getVoteCarrying(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getVoteCarrying(id);
  }

  @Get(':id/reactions')
  @UseGuards(OptionalAuthGuard)
  async listReactions(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.listReactions(id);
  }

  @Post(':id/reactions')
  @UseGuards(AuthGuard)
  async react(
    @Param('id') id: string,
    @Body() body: { emoji: string },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.act(id, req);
    return this.proposalsService.reactToProposal(id, req.user!.id, body.emoji);
  }

  @Delete(':id/reactions')
  @UseGuards(AuthGuard)
  async removeReaction(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.removeReaction(id, req.user!.id);
  }

  @Get(':id/options')
  @UseGuards(OptionalAuthGuard)
  async listOptions(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.listOptions(id);
  }

  @Post(':id/options')
  @UseGuards(AuthGuard)
  async createOption(
    @Param('id') id: string,
    @Body() body: { id: string; text: string; position: number },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.act(id, req);
    return this.proposalsService.createOption(id, req.user!.id, body);
  }

  @Delete(':id/options/:optionId')
  @UseGuards(AuthGuard)
  async deleteOption(
    @Param('id') id: string,
    @Param('optionId') optionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.act(id, req);
    return this.proposalsService.deleteOption(optionId, req.user!.id);
  }

  @Get(':id/signatures')
  @UseGuards(OptionalAuthGuard)
  async listSignatures(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.listSignatures(id);
  }

  @Post(':id/signatures')
  @UseGuards(AuthGuard)
  async sign(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.sign(id, req.user!.id);
  }

  @Delete(':id/signatures')
  @UseGuards(AuthGuard)
  async unsign(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.unsign(id, req.user!.id);
  }

  @Get(':id/links')
  @UseGuards(OptionalAuthGuard)
  async listLinks(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.listLinks(id);
  }

  @Post(':id/links')
  @UseGuards(AuthGuard)
  async addLink(
    @Param('id') id: string,
    @Body() body: { target_proposal_id: string; link_type: 'supersedes' | 'related_to' | 'blocks' | 'depends_on' },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.act(id, req);
    return this.proposalsService.addLink(id, req.user!.id, body);
  }

  @Delete(':id/links/:linkId')
  @UseGuards(AuthGuard)
  async removeLink(@Param('id') id: string, @Param('linkId') linkId: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.removeLink(linkId, req.user!.id);
  }

  @Get(':id/receipt')
  @UseGuards(AuthGuard)
  async getReceipt(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getVoteReceipt(id, req.user!.id);
  }

  @Get(':id/constitutional-outcome')
  @UseGuards(OptionalAuthGuard)
  async getConstitutionalOutcome(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getConstitutionalOutcome(id);
  }

  @Get(':id/watch')
  @UseGuards(AuthGuard)
  async getWatchStatus(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    const watching = await this.proposalsService.isWatching(id, req.user!.id);
    return { watching };
  }

  @Put(':id/watch')
  @UseGuards(AuthGuard)
  async watchProposal(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.watchProposal(id, req.user!.id);
  }

  @Delete(':id/watch')
  @UseGuards(AuthGuard)
  async unwatchProposal(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.unwatchProposal(id, req.user!.id);
  }

  @Get(':id/boosts')
  @UseGuards(AuthGuard)
  async getBoosts(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getBoostsForUser(id, req.user!.id);
  }

  @Post(':id/boost')
  @UseGuards(AuthGuard)
  async boost(@Param('id') id: string, @Body() body: { amount?: number }, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.boost(id, req.user!.id, body.amount ?? 1);
  }

  @Delete(':id/boost')
  @UseGuards(AuthGuard)
  async unboost(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.unboost(id, req.user!.id);
  }

  @Get(':id/predictions')
  @UseGuards(AuthGuard)
  async getPredictions(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.view(id, req);
    return this.proposalsService.getPredictions(id, req.user?.id ?? null);
  }

  @Post(':id/predict')
  @UseGuards(AuthGuard)
  async predict(
    @Param('id') id: string,
    @Body() body: { prediction: 'pass' | 'fail'; confidence: number },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.act(id, req);
    return this.proposalsService.predict(id, req.user!.id, body.prediction, body.confidence ?? 50);
  }

  @Delete(':id/predict')
  @UseGuards(AuthGuard)
  async unpredict(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.act(id, req);
    return this.proposalsService.unpredict(id, req.user!.id);
  }
}
