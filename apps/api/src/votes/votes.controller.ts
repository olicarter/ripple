import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { VotesService } from './votes.service';
import { verifyVoteEmailToken } from './vote-email.utils';
import { VoteChoice } from './vote.entity';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';

@Controller('votes')
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  @Get('by-email')
  async voteByEmail(
    @Query('proposal_id') proposalId: string,
    @Query('user_id') userId: string,
    @Query('choice') choice: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
    const redirect = (status: string, extra = '') =>
      res.redirect(`${appUrl}/vote-confirmed?status=${status}${extra}`);

    if (!proposalId || !userId || !choice || !token) return redirect('invalid');
    if (!verifyVoteEmailToken(proposalId, userId, choice, token)) return redirect('invalid');
    if (!['yes', 'no', 'abstain'].includes(choice)) return redirect('invalid');

    const ds = this.votesService.getDataSource();

    const proposals = await ds.query(
      `SELECT status FROM proposals WHERE id = $1`, [proposalId],
    );
    if (!proposals[0]) return redirect('invalid');
    if (proposals[0].status !== 'open') return redirect('closed');

    const existing = await ds.query(
      `SELECT id FROM votes WHERE proposal_id = $1 AND user_id = $2 LIMIT 1`, [proposalId, userId],
    );
    if (existing[0]) return redirect('already_voted');

    const { randomUUID } = await import('crypto');
    await this.votesService.create({
      id: randomUUID(),
      proposal_id: proposalId,
      user_id: userId,
      choice: choice as VoteChoice,
    });
    return redirect('success', `&proposal_id=${proposalId}`);
  }

  @Get('proposal/:proposalId')
  findByProposal(@Param('proposalId') proposalId: string) {
    return this.votesService.findByProposal(proposalId);
  }

  @Post()
  @UseGuards(AuthGuard)
  create(
    @Body() body: { id: string; proposal_id: string; user_id?: string; choice?: VoteChoice | null; option_id?: string | null; reason?: string | null; vote_count?: number },
    @Req() req: AuthenticatedRequest,
  ) {
    // Votes are always cast as the signed-in user; user_id is accepted only if it matches.
    if (body.user_id && body.user_id !== req.user!.id) {
      throw new ForbiddenException('You can only vote as yourself');
    }
    return this.votesService.create({ ...body, user_id: req.user!.id });
  }

  // Test mode only: cast a vote as any user, for e2e setup (see e2e/helpers.ts).
  @Post('test-cast')
  testCast(@Body() body: { id: string; proposal_id: string; user_id: string; choice?: VoteChoice | null; option_id?: string | null }) {
    if (process.env.NODE_ENV !== 'test') throw new ForbiddenException();
    return this.votesService.create(body);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  async update(@Param('id') id: string, @Body() body: { choice?: VoteChoice | null; option_id?: string | null; reason?: string | null }, @Req() req: AuthenticatedRequest) {
    await this.requireOwnVote(id, req.user!.id);
    return this.votesService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.requireOwnVote(id, req.user!.id);
    return this.votesService.delete(id);
  }

  private async requireOwnVote(id: string, userId: string) {
    const vote = await this.votesService.findOne(id);
    if (!vote) throw new NotFoundException('Vote not found');
    if (vote.user_id !== userId) throw new ForbiddenException('You can only change your own vote');
  }

  @Post('proposals/:proposalId/approvals')
  @UseGuards(AuthGuard)
  setApprovals(
    @Param('proposalId') proposalId: string,
    @Body() body: { option_ids: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.votesService.setApprovals(proposalId, req.user!.id, body.option_ids);
  }

  @Post('proposals/:proposalId/scores')
  @UseGuards(AuthGuard)
  setScores(
    @Param('proposalId') proposalId: string,
    @Body() body: { scores: Array<{ option_id: string; score: number }> },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.votesService.setScores(proposalId, req.user!.id, body.scores);
  }

  @Post('proposals/:proposalId/rankings')
  @UseGuards(AuthGuard)
  setRankings(
    @Param('proposalId') proposalId: string,
    @Body() body: { option_ids: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.votesService.setRankings(proposalId, req.user!.id, body.option_ids);
  }
}
