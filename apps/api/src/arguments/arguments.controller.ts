import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ArgumentsService } from './arguments.service';
import { AuthGuard, OptionalAuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AccessService } from '../access/access.service';

@Controller()
export class ArgumentsController {
  constructor(
    private readonly argumentsService: ArgumentsService,
    private readonly access: AccessService,
  ) {}

  @Get('proposals/:proposalId/arguments')
  @UseGuards(OptionalAuthGuard)
  async findByProposal(@Param('proposalId') proposalId: string, @Req() req: AuthenticatedRequest) {
    await this.access.assertCanViewProposal(proposalId, req.user?.id);
    return this.argumentsService.findByProposal(proposalId);
  }

  @Post('proposals/:proposalId/arguments')
  @UseGuards(AuthGuard)
  create(
    @Param('proposalId') proposalId: string,
    @Body() body: { id: string; side: 'for' | 'against'; body: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.argumentsService.create({
      id: body.id,
      proposal_id: proposalId,
      author_id: req.user!.id,
      side: body.side,
      body: body.body,
    });
  }

  @Delete('arguments/:id')
  @UseGuards(AuthGuard)
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.argumentsService.delete(id, req.user!.id);
  }
}
