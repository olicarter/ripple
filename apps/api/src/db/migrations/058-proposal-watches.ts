import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProposalWatches1748600000058 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS proposal_watches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(proposal_id, user_id)
      )
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query(`DROP TABLE proposal_watches`);
  }
}
