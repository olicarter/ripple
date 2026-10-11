import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { AuthGuard, OptionalAuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AccessService } from '../access/access.service';

@Controller()
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly access: AccessService,
  ) {}

  @Get('proposals/:proposalId/comments')
  @UseGuards(OptionalAuthGuard)
  async findByProposal(@Param('proposalId') proposalId: string, @Req() req: AuthenticatedRequest) {
    await this.access.assertCanViewProposal(proposalId, req.user?.id);
    return this.commentsService.findByProposal(proposalId);
  }

  @Post('proposals/:proposalId/comments')
  @UseGuards(AuthGuard)
  async create(
    @Param('proposalId') proposalId: string,
    @Body() body: { id: string; body: string; parent_comment_id?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.access.assertCanActOnProposal(proposalId, req.user!.id);
    return this.commentsService.create({
      id: body.id,
      proposal_id: proposalId,
      author_id: req.user!.id,
      body: body.body,
      parent_comment_id: body.parent_comment_id ?? null,
    });
  }

  @Patch('comments/:id')
  @UseGuards(AuthGuard)
  edit(@Param('id') id: string, @Body() body: { body: string }, @Req() req: AuthenticatedRequest) {
    return this.commentsService.edit(id, req.user!.id, body.body);
  }

  @Delete('comments/:id')
  @UseGuards(AuthGuard)
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.commentsService.delete(id, req.user!.id);
  }

  @Post('comments/:id/pin')
  @UseGuards(AuthGuard)
  pin(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.commentsService.pin(id, req.user!.id);
  }

  @Post('comments/:id/unpin')
  @UseGuards(AuthGuard)
  unpin(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.commentsService.unpin(id, req.user!.id);
  }

  @Post('comments/:id/hide')
  @UseGuards(AuthGuard)
  hide(@Param('id') id: string, @Body() body: { reason: string }, @Req() req: AuthenticatedRequest) {
    return this.commentsService.hide(id, req.user!.id, body.reason ?? '');
  }

  @Post('comments/:id/unhide')
  @UseGuards(AuthGuard)
  unhide(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.commentsService.unhide(id, req.user!.id);
  }

  @Post('comments/:id/reactions')
  @UseGuards(AuthGuard)
  async toggleReaction(
    @Param('id') id: string,
    @Body() body: { emoji: string },
    @Req() req: AuthenticatedRequest,
  ) {
    await this.access.assertCanActOnProposal(await this.access.commentProposalId(id), req.user!.id);
    return this.commentsService.toggleReaction(id, req.user!.id, body.emoji);
  }
}
