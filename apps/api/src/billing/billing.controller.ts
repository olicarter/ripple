import { Body, Controller, Get, Headers, Param, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AccessService } from '../access/access.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly access: AccessService,
  ) {}

  @Get(':orgId/status')
  @UseGuards(AuthGuard)
  async getStatus(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    await this.access.assertRole(orgId, req.user!.id, 'observer');
    return this.billingService.getStatus(orgId);
  }

  @Post(':orgId/checkout')
  @UseGuards(AuthGuard)
  createCheckout(
    @Param('orgId') orgId: string,
    @Body() body: { return_url: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.billingService.createCheckoutSession(orgId, req.user!.id, body.return_url);
  }

  @Post(':orgId/portal')
  @UseGuards(AuthGuard)
  createPortal(
    @Param('orgId') orgId: string,
    @Body() body: { return_url: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.billingService.createPortalSession(orgId, req.user!.id, body.return_url);
  }

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    await this.billingService.handleWebhook(req.rawBody!, signature);
    return { received: true };
  }
}
