import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Redirect, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { Throttle } from '@nestjs/throttler';

// Endpoints that start a sign-in or send email get a much lower per-IP limit than
// the global one, to slow credential stuffing and email bombing.
const AUTH_THROTTLE = { default: { limit: process.env.NODE_ENV === 'test' ? 10_000 : 10, ttl: 60_000 } };
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organisation } from '../organisations/organisation.entity';
import { Membership } from '../organisations/membership.entity';
import { randomBytes, randomUUID } from 'crypto';
import * as oidcClient from 'openid-client';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidcService: OidcService,
    @InjectRepository(Organisation)
    private readonly orgRepo: Repository<Organisation>,
    @InjectRepository(Membership)
    private readonly memberRepo: Repository<Membership>,
  ) {}

  @Post('register/begin')
  @Throttle(AUTH_THROTTLE)
  registerBegin(@Body() body: { name: string; email: string }) {
    return this.authService.registerBegin(body);
  }

  @Post('register/finish')
  @Throttle(AUTH_THROTTLE)
  registerFinish(@Body() body: RegistrationResponseJSON, @Req() req: Request) {
    return this.authService.registerFinish(body, req);
  }

  @Post('login/begin')
  @Throttle(AUTH_THROTTLE)
  loginBegin() {
    return this.authService.loginBegin();
  }

  @Post('login/finish')
  @Throttle(AUTH_THROTTLE)
  loginFinish(@Body() body: AuthenticationResponseJSON, @Req() req: Request) {
    return this.authService.loginFinish(body, req);
  }

  @UseGuards(AuthGuard)
  @Get('passkeys')
  listPasskeys(@Req() req: AuthenticatedRequest) {
    return this.authService.listPasskeys(req.user!.id);
  }

  @UseGuards(AuthGuard)
  @Post('add-passkey/begin')
  addPasskeyBegin(@Req() req: AuthenticatedRequest) {
    return this.authService.addPasskeyBegin(req.user!.id);
  }

  @UseGuards(AuthGuard)
  @Post('add-passkey/finish')
  addPasskeyFinish(@Body() body: RegistrationResponseJSON, @Req() req: AuthenticatedRequest) {
    return this.authService.addPasskeyFinish(body, req.user!.id);
  }

  @UseGuards(AuthGuard)
  @Delete('passkeys/:id')
  deletePasskey(@Param('id') credentialId: string, @Req() req: AuthenticatedRequest) {
    return this.authService.deletePasskey(credentialId, req.user!.id);
  }

  @Post('magic/begin')
  @Throttle(AUTH_THROTTLE)
  magicLinkBegin(@Body() body: { email: string }) {
    return this.authService.magicLinkBegin(body.email);
  }

  @Post('magic/verify')
  @Throttle(AUTH_THROTTLE)
  magicLinkVerify(@Query('token') token: string, @Req() req: Request) {
    return this.authService.magicLinkVerify(token, req);
  }

  @Post('verify-email')
  @Throttle(AUTH_THROTTLE)
  verifyEmail(@Body() body: { token: string }) {
    return this.authService.verifyEmail(body.token);
  }

  @Post('logout')
  logout(@Req() req: Request) {
    return this.authService.logout(req);
  }

  @Post('test-reset')
  testReset() {
    if (process.env.NODE_ENV !== 'test') throw new ForbiddenException();
    return this.authService.testReset();
  }

  @Post('test-setup')
  testSetup(@Body() body: { name: string; email: string }, @Req() req: Request) {
    if (process.env.NODE_ENV !== 'test') throw new ForbiddenException();
    return this.authService.testSetup(body, req);
  }

  // --- OIDC SSO ---

  @Get('sso/:slug')
  async ssoInitiate(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const org = await this.orgRepo.findOneBy({ slug });
    if (!org?.oidc_issuer || !org.oidc_client_id || !org.oidc_client_secret) {
      res.status(404).json({ message: 'SSO not configured for this organisation' });
      return;
    }

    const state = oidcClient.randomState();
    const codeVerifier = oidcClient.randomPKCECodeVerifier();

    req.session!.oidcState = state;
    req.session!.oidcCodeVerifier = codeVerifier;
    req.session!.oidcOrgSlug = slug;

    const authUrl = await this.oidcService.buildAuthUrl(
      org.oidc_issuer, org.oidc_client_id, org.oidc_client_secret, slug, state, codeVerifier,
    );

    res.redirect(authUrl.toString());
  }

  @Get('sso/:slug/callback')
  async ssoCallback(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

    const expectedState = req.session?.oidcState as string | undefined;
    const codeVerifier = req.session?.oidcCodeVerifier as string | undefined;
    const sessionSlug = req.session?.oidcOrgSlug as string | undefined;

    if (!expectedState || !codeVerifier || sessionSlug !== slug) {
      res.redirect(`${appUrl}/login?error=sso_state_mismatch`);
      return;
    }

    const org = await this.orgRepo.findOneBy({ slug });
    if (!org?.oidc_issuer || !org.oidc_client_id || !org.oidc_client_secret) {
      res.redirect(`${appUrl}/login?error=sso_not_configured`);
      return;
    }

    try {
      const currentUrl = new URL(`${process.env.API_URL ?? 'http://localhost:3000'}/api/auth/sso/${slug}/callback?${new URLSearchParams(req.query as Record<string, string>).toString()}`);

      const userInfo = await this.oidcService.exchangeCode(
        org.oidc_issuer, org.oidc_client_id, org.oidc_client_secret,
        slug, currentUrl, expectedState, codeVerifier,
      );

      // Clear SSO session data
      delete req.session!.oidcState;
      delete req.session!.oidcCodeVerifier;
      delete req.session!.oidcOrgSlug;

      // Find or create user
      let user = await this.authService.findByEmail(userInfo.email);
      if (!user) {
        user = await this.authService.createUserFromSso({
          email: userInfo.email,
          name: userInfo.name ?? userInfo.email.split('@')[0],
          ssoSub: userInfo.sub,
        });
      }

      // Auto-provision to org as member
      const existing = await this.memberRepo.findOneBy({ organisation_id: org.id, user_id: user.id });
      if (!existing) {
        await this.memberRepo.save(
          this.memberRepo.create({
            id: randomUUID(),
            organisation_id: org.id,
            user_id: user.id,
            role: 'member',
            status: 'approved',
          }),
        );
      }

      req.session!.userId = user.id;
      res.redirect(`${appUrl}/orgs/${slug}/proposals`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'sso_error';
      res.redirect(`${appUrl}/login?error=${encodeURIComponent(message)}`);
    }
  }

  @Get('sso/:slug/config')
  async getSsoConfig(@Param('slug') slug: string) {
    const org = await this.orgRepo.findOneBy({ slug });
    if (!org) return { configured: false };
    return {
      configured: !!(org.oidc_issuer && org.oidc_client_id),
      sso_required: org.sso_required,
      issuer: org.oidc_issuer,
    };
  }
}
