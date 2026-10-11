import { MigrationInterface, QueryRunner } from 'typeorm';

// The web app syncs proposal_options through Electric, but the table was never
// added to the publication, so every shape request for it failed.
export class PublishProposalOptions1748600000082 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE public.proposal_options REPLICA IDENTITY FULL`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'electric_publication_default' AND tablename = 'proposal_options'
        ) THEN
          ALTER PUBLICATION electric_publication_default ADD TABLE public.proposal_options;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER PUBLICATION electric_publication_default DROP TABLE public.proposal_options`);
    await queryRunner.query(`ALTER TABLE public.proposal_options REPLICA IDENTITY DEFAULT`);
  }
}
