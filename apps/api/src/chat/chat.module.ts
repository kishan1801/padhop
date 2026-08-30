import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { HelipadsModule } from '../helipads/helipads.module';
import { WeatherModule } from '../weather/weather.module';

@Module({
  imports: [HelipadsModule, WeatherModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule { }