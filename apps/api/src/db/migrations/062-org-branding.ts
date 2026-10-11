import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrgBranding1748600000062 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organisations
      ADD COLUMN IF NOT EXISTS primary_color TEXT,
      ADD COLUMN IF NOT EXISTS logo_url TEXT
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organisations
      DROP COLUMN primary_color,
      DROP COLUMN logo_url
    `);
  }
}
