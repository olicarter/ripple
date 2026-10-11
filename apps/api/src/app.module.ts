import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from './users/users.module';
import { TopicsModule } from './topics/topics.module';
import { ProposalsModule } from './proposals/proposals.module';
import { DelegationsModule } from './delegations/delegations.module';
import { VotesModule } from './votes/votes.module';
import { AuthModule } from './auth/auth.module';
import { CommentsModule } from './comments/comments.module';
import { OrganisationsModule } from './organisations/organisations.module';
import { ArgumentsModule } from './arguments/arguments.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { VetoesModule } from './vetoes/vetoes.module';
import { EndorsementsModule } from './endorsements/endorsements.module';
import { User } from './users/user.entity';
import { Topic } from './topics/topic.entity';
import { Proposal } from './proposals/proposal.entity';
import { Delegation } from './delegations/delegation.entity';
import { Vote } from './votes/vote.entity';
import { Credential } from './auth/credential.entity';
import { MagicLink } from './auth/magic-link.entity';
import { Comment } from './comments/comment.entity';
import { CommentReaction } from './comments/comment-reaction.entity';
import { ProposalVersion } from './proposals/proposal-version.entity';
import { Organisation } from './organisations/organisation.entity';
import { Membership } from './organisations/membership.entity';
import { OrgInvite } from './organisations/org-invite.entity';
import { Argument } from './arguments/argument.entity';
import { AuditLogEntry } from './audit-log/audit-log.entity';
import { Veto } from './vetoes/veto.entity';
import { Endorsement } from './endorsements/endorsement.entity';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailModule } from './email/email.module';
import { BillingModule } from './billing/billing.module';
import { SlackModule } from './slack/slack.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WebhookEndpoint } from './webhooks/webhook-endpoint.entity';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { ApiKey } from './api-keys/api-key.entity';
import { JobsModule } from './jobs/jobs.module';
import { RedisModule } from './redis/redis.module';
import { ScimModule } from './scim/scim.module';
import { Notification } from './notifications/notification.entity';
import { ProposalOption } from './proposals/proposal-option.entity';
import { ProposalReaction } from './proposals/proposal-reaction.entity';
import { ProposalSignature } from './proposals/proposal-signature.entity';
import { ProposalLink } from './proposals/proposal-link.entity';
import { ProposalBoost } from './proposals/proposal-boost.entity';
import { Prediction } from './proposals/prediction.entity';
import { AiModule } from './ai/ai.module';
import { ElectricModule } from './electric/electric.module';
import { AccessModule } from './access/access.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 300 }]),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgresql://postgres:password@localhost:5432/ripple',
      poolSize: Number(process.env.DB_POOL_SIZE ?? 10),
      extra: {
        max: Number(process.env.DB_POOL_SIZE ?? 10),
        min: 2,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        // Read replica: set REPLICA_DATABASE_URL to route reads to a standby
        ...(process.env.REPLICA_DATABASE_URL ? {
          replication: {
            master: { connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/ripple' },
            slaves: [{ connectionString: process.env.REPLICA_DATABASE_URL }],
          },
        } : {}),
      },
      entities: [User, Topic, Proposal, ProposalOption, ProposalReaction, ProposalVersion, ProposalSignature, ProposalLink, ProposalBoost, Prediction, Delegation, Vote, Credential, MagicLink, Comment, CommentReaction, Organisation, Membership, OrgInvite, Argument, AuditLogEntry, Veto, Endorsement, Notification, WebhookEndpoint, ApiKey],
      // .ts under ts-node in development, compiled .js in production (never the emitted .d.ts).
      migrations: [__dirname + `/db/migrations/*${__filename.endsWith('.ts') ? '.ts' : '.js'}`],
      migrationsRun: true,
      synchronize: false,
    }),
    UsersModule,
    TopicsModule,
    ProposalsModule,
    DelegationsModule,
    VotesModule,
    AuthModule,
    CommentsModule,
    OrganisationsModule,
    ArgumentsModule,
    AuditLogModule,
    VetoesModule,
    EndorsementsModule,
    NotificationsModule,
    EmailModule,
    BillingModule,
    SlackModule,
    WebhooksModule,
    ApiKeysModule,
    RedisModule,
    JobsModule,
    ScimModule,
    AiModule,
    ElectricModule,
    AccessModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
