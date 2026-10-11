import { Controller, ForbiddenException, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Readable } from 'stream';
import type { Request, Response } from 'express';
import { resolveShape, ShapeForbiddenError, type ShapeViewer } from './shape-policy';

const ELECTRIC_URL = process.env.ELECTRIC_URL ?? 'http://localhost:3000';
const ELECTRIC_SECRET = process.env.ELECTRIC_SECRET ?? 'ripple-dev-electric-secret';

// Electric protocol params the client controls. Everything that decides *what*
// is synced (table, columns, where) is set server-side.
const PASSTHROUGH_PARAMS = ['offset', 'handle', 'live', 'cursor', 'live_sse', 'experimental_live_sse', 'replica', 'log'];

// Hop-by-hop headers, plus encoding headers that no longer apply once fetch() has decoded the body.
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('electric')
@SkipThrottle()
export class ElectricController {
  private readonly logger = new Logger(ElectricController.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('v1/shape')
  async shape(@Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const viewer = await this.loadViewer(req.session?.userId);

    let shape;
    try {
      shape = await resolveShape(
        query.table, query.where, viewer,
        () => this.coMemberIds(viewer),
        (orgId) => this.privateVoteProposalIds(orgId),
      );
    } catch (err) {
      if (err instanceof ShapeForbiddenError) throw new ForbiddenException(err.message);
      throw err;
    }

    const url = new URL('/v1/shape', ELECTRIC_URL);
    for (const key of PASSTHROUGH_PARAMS) {
      if (typeof query[key] === 'string') url.searchParams.set(key, query[key]);
    }
    url.searchParams.set('table', query.table);
    if (shape.where) url.searchParams.set('where', shape.where);
    if (shape.columns) url.searchParams.set('columns', shape.columns.join(','));
    url.searchParams.set('secret', ELECTRIC_SECRET);

    const abort = new AbortController();
    res.on('close', () => abort.abort());

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(url, { signal: abort.signal });
    } catch (err) {
      if (abort.signal.aborted) return;
      this.logger.error(`Electric request failed: ${(err as Error).message}`);
      res.status(502).json({ message: 'Sync service unavailable' });
      return;
    }

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (DROPPED_RESPONSE_HEADERS.has(key)) return;
      // Responses depend on the viewer's session, so shared caches must not store them.
      if (key === 'cache-control') value = value.replace(/\bpublic\b/, 'private');
      res.setHeader(key, value);
    });
    res.setHeader('Vary', 'Cookie');

    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as import('stream/web').ReadableStream)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  private async loadViewer(sessionUserId: string | undefined): Promise<ShapeViewer> {
    const userId = sessionUserId && UUID_RE.test(sessionUserId) ? sessionUserId : null;
    const publicRows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM organisations WHERE is_public = true`,
    );
    const memberRows = userId
      ? await this.dataSource.query<Array<{ organisation_id: string }>>(
          `SELECT organisation_id FROM memberships WHERE user_id = $1 AND status = 'approved'`,
          [userId],
        )
      : [];
    return {
      userId,
      memberOrgIds: memberRows.map((r) => r.organisation_id),
      publicOrgIds: publicRows.map((r) => r.id),
    };
  }

  /** Proposals whose votes only their voters may see (see shape-policy.ts). */
  private async privateVoteProposalIds(orgId: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT p.id FROM proposals p JOIN organisations o ON o.id = p.organisation_id
       WHERE p.organisation_id = $1
         AND (p.anonymous_voting OR (o.voting_visibility = 'hidden' AND p.status = 'open'))`,
      [orgId],
    );
    return rows.map((r) => r.id);
  }

  /** Users who belong (in any status) to an org the viewer is an approved member of. */
  private async coMemberIds(viewer: ShapeViewer): Promise<string[]> {
    if (viewer.memberOrgIds.length === 0) return [];
    const rows = await this.dataSource.query<Array<{ user_id: string }>>(
      `SELECT DISTINCT user_id FROM memberships WHERE organisation_id = ANY($1::uuid[])`,
      [viewer.memberOrgIds],
    );
    return rows.map((r) => r.user_id);
  }
}
