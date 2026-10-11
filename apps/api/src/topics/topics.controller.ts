import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { AuthGuard, OptionalAuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AccessService } from '../access/access.service';

@Controller('topics')
export class TopicsController {
  constructor(
    private readonly topicsService: TopicsService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  async findByOrg(@Query('org') orgId: string, @Req() req: AuthenticatedRequest) {
    if (!orgId) throw new BadRequestException('The org query parameter is required');
    await this.access.assertCanViewOrg(orgId, req.user?.id);
    return this.topicsService.findByOrg(orgId);
  }

  @Post()
  @UseGuards(AuthGuard)
  create(
    @Body() body: { id: string; organisation_id: string; name: string; description?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.topicsService.create(body, req.user!.id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string; is_constitutional?: boolean }, @Req() req: AuthenticatedRequest) {
    return this.topicsService.update(id, body, req.user!.id);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.topicsService.delete(id, req.user!.id);
  }
}
