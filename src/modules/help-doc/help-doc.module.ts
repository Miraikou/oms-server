import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HelpDoc } from './entities/help-doc.entity';
import { HelpDocService } from './help-doc.service';
import { HelpDocController } from './help-doc.controller';

@Module({
  imports: [TypeOrmModule.forFeature([HelpDoc])],
  controllers: [HelpDocController],
  providers: [HelpDocService],
  exports: [HelpDocService],
})
export class HelpDocModule implements OnModuleInit {
  constructor(private readonly helpDocService: HelpDocService) {}

  async onModuleInit() {
    await this.helpDocService.seedDocs();
  }
}
