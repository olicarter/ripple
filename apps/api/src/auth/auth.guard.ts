import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import type { Request } from 'express';

declare module 'express-session' {
  interface Session {
    userId?: string;
    oidcState?: string;
    oidcCodeVerifier?: string;
    oidcOrgSlug?: string;
    slackOAuth?: { state: string; orgSlug: string };
  }
}

export interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Session-based auth
    const userId = request.session?.userId;
    if (userId) {
      request.user = { id: userId };
      return true;
    }

    // Bearer API key auth
    const authHeader = request.headers['authorization'];
    if (authHeader?.startsWith('Bearer rk_')) {
      const rawKey = authHeader.slice('Bearer '.length);
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const row = await this.dataSource.query<Array<{ created_by_user_id: string; revoked_at: string | null }>>(
        `SELECT created_by_user_id, revoked_at FROM api_keys WHERE key_hash = $1 LIMIT 1`,
        [keyHash],
      );
      if (row.length > 0 && !row[0].revoked_at) {
        request.user = { id: row[0].created_by_user_id };
        // Update last_used_at without blocking
        this.dataSource.query(`UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1`, [keyHash]).catch(() => {});
        return true;
      }
    }

    throw new UnauthorizedException('Authentication required');
  }
}

/**
 * Like AuthGuard, but lets anonymous requests through (req.user stays unset).
 * For endpoints that public orgs expose to everyone and private orgs to members.
 */
@Injectable()
export class OptionalAuthGuard extends AuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch (err) {
      if (err instanceof UnauthorizedException) return true;
      throw err;
    }
  }
}
