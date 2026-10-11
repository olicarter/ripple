import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DelegationsService } from './delegations.service';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AccessService } from '../access/access.service';

@Controller('delegations')
export class DelegationsController {
  constructor(
    private readonly delegationsService: DelegationsService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  async findByOrg(@Query('org') orgId: string, @Req() req: AuthenticatedRequest) {
    if (!orgId) throw new BadRequestException('The org query parameter is required');
    await this.access.assertRole(orgId, req.user!.id, 'observer');
    return this.delegationsService.findByOrg(orgId);
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(
    @Body() body: { id: string; organisation_id: string; delegator_id?: string; delegate_id: string; topic_id?: string | null; expires_at?: string | null; fallback_abstain_hours?: number | null; weight_fraction?: number | null },
    @Req() req: AuthenticatedRequest,
  ) {
    // You can only delegate your own vote, to another approved member of the same org.
    if (body.delegator_id && body.delegator_id !== req.user!.id) {
      throw new ForbiddenException('You can only delegate your own vote');
    }
    if (body.delegate_id === req.user!.id) throw new BadRequestException('You cannot delegate to yourself');
    if (!body.organisation_id || !body.delegate_id) throw new BadRequestException('organisation_id and delegate_id are required');
    await this.access.assertRole(body.organisation_id, req.user!.id);
    if (!(await this.access.role(body.organisation_id, body.delegate_id))) {
      throw new BadRequestException('The delegate is not a member of this organisation');
    }
    if (body.topic_id && !(await this.delegationsService.topicBelongsToOrg(body.topic_id, body.organisation_id))) {
      throw new BadRequestException('Topic does not belong to this organisation');
    }
    return this.delegationsService.create({ ...body, delegator_id: req.user!.id });
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const delegation = await this.delegationsService.findOne(id);
    if (!delegation) throw new NotFoundException('Delegation not found');
    if (delegation.delegator_id !== req.user!.id) throw new ForbiddenException('You can only remove your own delegations');
    return this.delegationsService.delete(id);
  }

  @Get('history')
  @UseGuards(AuthGuard)
  history(@Req() req: AuthenticatedRequest) {
    return this.delegationsService.getHistory(req.user!.id);
  }
}
