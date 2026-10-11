import { MigrationInterface, QueryRunner } from 'typeorm';

// Electric (with ELECTRIC_MANUAL_TABLE_PUBLISHING) refuses to serve shapes for
// tables whose replica identity isn't FULL. Apply it to every table currently in
// the publication. Any table added to the publication later needs the same.
export class ElectricReplicaIdentity1748600000081 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE t record;
      BEGIN
        FOR t IN
          SELECT schemaname, tablename FROM pg_publication_tables
          WHERE pubname = 'electric_publication_default'
        LOOP
          EXECUTE format('ALTER TABLE %I.%I REPLICA IDENTITY FULL', t.schemaname, t.tablename);
        END LOOP;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE t record;
      BEGIN
        FOR t IN
          SELECT schemaname, tablename FROM pg_publication_tables
          WHERE pubname = 'electric_publication_default'
        LOOP
          EXECUTE format('ALTER TABLE %I.%I REPLICA IDENTITY DEFAULT', t.schemaname, t.tablename);
        END LOOP;
      END $$;
    `);
  }
}
