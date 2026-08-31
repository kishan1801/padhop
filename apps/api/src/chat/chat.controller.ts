import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) { }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post()
  async chat(@Body() body: { message: string }) {
    const message = body.message?.trim();

    if (!message) {
      return { reply: 'Please type a question about helicopter charters.' };
    }
    if (message.length > 500) {
      return { reply: 'That message is too long — try asking in a shorter, more specific way.' };
    }

    const reply = await this.chatService.chat(message);
    return { reply };
  }
}