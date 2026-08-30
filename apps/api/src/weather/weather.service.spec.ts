import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { WeatherService } from './weather.service';

describe('WeatherService', () => {
  let service: WeatherService;
  let http: { get: jest.Mock };

  beforeEach(async () => {
    http = { get: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [WeatherService, { provide: HttpService, useValue: http }],
    }).compile();

    service = module.get(WeatherService);
  });

  function mockForecast(windSpeedKmh: number, precipitationMm: number, visibilityM: number) {
    http.get.mockReturnValue(
      of({
        data: {
          hourly: {
            time: ['2026-09-02T14:00'],
            windspeed_10m: [windSpeedKmh],
            precipitation: [precipitationMm],
            visibility: [visibilityM],
          },
        },
      }),
    );
  }

  it('scores clear conditions as good with a high score', async () => {
    mockForecast(10, 0, 10000);
    const result = await service.getFlightRisk(12.9634, 77.6484, '2026-09-02T14:00:00');
    expect(result.verdict).toBe('good');
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('scores high wind and low visibility as unsafe', async () => {
    mockForecast(70, 6, 1500);
    const result = await service.getFlightRisk(12.9634, 77.6484, '2026-09-02T14:00:00');
    expect(result.verdict).toBe('unsafe');
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});