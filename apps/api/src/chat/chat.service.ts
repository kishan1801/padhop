import { Injectable } from '@nestjs/common';
import Groq from 'groq-sdk';
import { HelipadsService } from '../helipads/helipads.service';
import { WeatherService } from '../weather/weather.service';

const tools: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_helipads',
      description: 'Find helipads near a given latitude/longitude with live availability',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          radiusKm: { type: 'number', description: 'Search radius in km, default 50' },
        },
        required: ['latitude', 'longitude'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_weather',
      description: 'Check flight-safety weather risk for a location and time',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          isoTime: { type: 'string', description: 'ISO 8601 date-time, e.g. 2026-09-05T14:00:00' },
        },
        required: ['latitude', 'longitude', 'isoTime'],
      },
    },
  },
];

@Injectable()
export class ChatService {
  private groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  constructor(
    private helipadsService: HelipadsService,
    private weatherService: WeatherService,
  ) { }

  async chat(userMessage: string): Promise<string> {
    const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          "You are PadHop's helicopter charter assistant for India. You ONLY discuss helicopter charter availability, helipad locations, flight-weather conditions, and how PadHop's booking process works. If asked about anything unrelated (general knowledge, other topics, requests to write content, etc.), politely decline and redirect the conversation back to helicopter charters. Use the available tools for real data. Be concise and specific. Bengaluru city center is roughly latitude 12.9716, longitude 77.5946.",
      },
      { role: 'user', content: userMessage },
    ];

    for (let i = 0; i < 4; i++) {
      const response = await this.groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages,
        tools,
      });

      const choice = response.choices[0].message;
      console.log(`--- Loop ${i} ---`);
      console.log('Content:', choice.content);
      console.log('Tool calls:', JSON.stringify(choice.tool_calls, null, 2));

      messages.push(choice);


      if (!choice.tool_calls || choice.tool_calls.length === 0) {
        return choice.content ?? 'I could not find an answer to that.';
      }

      for (const toolCall of choice.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        let result: unknown;

        if (toolCall.function.name === 'search_helipads') {
          result = await this.helipadsService.findNearest(
            args.latitude,
            args.longitude,
            args.radiusKm,
          );
        } else if (toolCall.function.name === 'check_weather') {
          result = await this.weatherService.getFlightRisk(
            args.latitude,
            args.longitude,
            args.isoTime,
          );
        } else {
          result = { error: 'Unknown tool' };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    return 'I had trouble finding a complete answer. Try rephrasing your question.';
  }
}