import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { TransportChannel } from './entities/transport-channel.entity'
import { TransportChannelService } from './transport-channel.service'
import { TransportChannelController } from './transport-channel.controller'

@Module({
  imports: [TypeOrmModule.forFeature([TransportChannel])],
  controllers: [TransportChannelController],
  providers: [TransportChannelService],
  exports: [TransportChannelService],
})
export class TransportChannelModule {}
