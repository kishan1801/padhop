import { Controller, Get, Query } from '@nestjs/common';
import { WeatherService } from './weather.service';

@Controller('weather')
export class WeatherController {
  constructor(private weatherService: WeatherService) { }

  @Get('risk')
  async risk(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('time') time: string,
  ) {
    return this.weatherService.getFlightRisk(parseFloat(lat), parseFloat(lng), time);
  }
}