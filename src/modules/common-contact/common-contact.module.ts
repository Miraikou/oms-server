import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonContact } from './entities/common-contact.entity';
import { CommonContactService } from './common-contact.service';
import { CommonContactController } from './common-contact.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CommonContact])],
  controllers: [CommonContactController],
  providers: [CommonContactService],
  exports: [CommonContactService],
})
export class CommonContactModule {}
