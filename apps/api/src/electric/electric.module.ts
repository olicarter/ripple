import { Module } from '@nestjs/common';
import { ElectricController } from './electric.controller';

@Module({
  controllers: [ElectricController],
})
export class ElectricModule {}
