import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { VetoesService } from './vetoes.service';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AccessService } from '../access/access.service';

@Controller()
export class VetoesController {
  constructor(
    private readonly vetoesService: VetoesService,
    private readonly access: AccessService,
  ) {}

  @Get('proposals/:id/vetoes')
  @UseGuards(AuthGuard)
  async listVetoes(@Param('id') proposalId: string, @Req() req: AuthenticatedRequest) {
    await this.access.assertCanViewProposal(proposalId, req.user!.id);
    return this.vetoesService.findByProposal(proposalId);
  }

  @Post('proposals/:id/vetoes')
  @UseGuards(AuthGuard)
  castVeto(
    @Param('id') proposalId: string,
    @Body('reason') reason: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vetoesService.cast(proposalId, req.user!.id, reason);
  }

  @Delete('vetoes/:id')
  @UseGuards(AuthGuard)
  retractVeto(@Param('id') vetoId: string, @Req() req: AuthenticatedRequest) {
    return this.vetoesService.retract(vetoId, req.user!.id);
  }
}
