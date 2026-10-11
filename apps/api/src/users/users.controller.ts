import { Body, Controller, Delete, ForbiddenException, Get, Header, NotFoundException, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { type Response } from 'express';
import { UsersService } from './users.service';
import type { User } from './user.entity';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';

function toPublicUser(user: User) {
  const { id, name, avatar_url, bio, created_at } = user;
  return { id, name, avatar_url, bio, created_at };
}

function requireSelf(req: AuthenticatedRequest, id: string) {
  if (req.user!.id !== id) throw new ForbiddenException('You can only modify your own account');
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Public profile fields only — no email or verification tokens.
  @Get()
  async findAll() {
    return (await this.usersService.findAll()).map(toPublicUser);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const user = await this.usersService.findOne(id);
    if (!user) throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@Body() body: { id: string; name: string; email: string }) {
    return this.usersService.create(body);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  update(@Param('id') id: string, @Body() body: { name?: string; email?: string; bio?: string | null; avatar_url?: string | null }, @Req() req: AuthenticatedRequest) {
    requireSelf(req, id);
    return this.usersService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    requireSelf(req, id);
    return this.usersService.delete(id);
  }

  @Post('me/anonymize')
  @UseGuards(AuthGuard)
  async anonymize(@Req() req: AuthenticatedRequest) {
    await this.usersService.anonymize(req.user!.id);
    return { success: true };
  }

  @Get('me/notification-preferences')
  @UseGuards(AuthGuard)
  getNotificationPreferences(@Req() req: AuthenticatedRequest) {
    return this.usersService.getNotificationPreferences(req.user!.id);
  }

  @Patch('me/notification-preferences')
  @UseGuards(AuthGuard)
  updateNotificationPreferences(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, boolean>,
  ) {
    return this.usersService.updateNotificationPreferences(req.user!.id, body);
  }

  @Get('me/org-email-preferences')
  @UseGuards(AuthGuard)
  getOrgEmailPreferences(@Req() req: AuthenticatedRequest) {
    return this.usersService.getOrgEmailPreferences(req.user!.id);
  }

  @Get('me/export')
  @UseGuards(AuthGuard)
  async exportPersonalData(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const data = await this.usersService.exportPersonalData(req.user!.id);
    const filename = `ripple-personal-data-${req.user!.id}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(data, null, 2));
  }
}
