import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) { }

  @Post()
  async chat(@Body() body: { message: string }) {
    const reply = await this.chatService.chat(body.message);
    return { reply };
  }
}