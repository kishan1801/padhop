import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export type WeatherRisk = {
  score: number; // 0-100, higher = safer to fly
  windSpeedKmh: number;
  precipitationMm: number;
  visibilityKm: number;
  verdict: 'good' | 'caution' | 'unsafe';
  reasons: string[];
};

@Injectable()
export class WeatherService {
  constructor(private http: HttpService) { }

  async getFlightRisk(latitude: number, longitude: number, isoTime: string): Promise<WeatherRisk> {
    const url = `https://api.open-meteo.com/v1/forecast`;
    const { data } = await firstValueFrom(
      this.http.get(url, {
        params: {
          latitude,
          longitude,
          hourly: 'windspeed_10m,precipitation,visibility',
          timezone: 'auto',
        },
      }),
    );

    const targetHour = isoTime.slice(0, 13); // "2026-08-28T10"
    const index = data.hourly.time.findIndex((t: string) => t.startsWith(targetHour));

    if (index === -1) {
      return {
        score: 50,
        windSpeedKmh: 0,
        precipitationMm: 0,
        visibilityKm: 0,
        verdict: 'caution',
        reasons: ['No forecast data available for this time - treat with caution'],
      };
    }

    const windSpeedKmh = data.hourly.windspeed_10m[index];
    const precipitationMm = data.hourly.precipitation[index];
    const visibilityKm = data.hourly.visibility[index] / 1000;

    return this.score(windSpeedKmh, precipitationMm, visibilityKm);
  }

  private score(windSpeedKmh: number, precipitationMm: number, visibilityKm: number): WeatherRisk {
    let score = 100;
    const reasons: string[] = [];

    if (windSpeedKmh > 55) {
      score -= 50;
      reasons.push(`High wind speed (${windSpeedKmh.toFixed(0)} km/h) - exceeds typical safe operating limits`);
    } else if (windSpeedKmh > 35) {
      score -= 20;
      reasons.push(`Elevated wind speed (${windSpeedKmh.toFixed(0)} km/h)`);
    }

    if (precipitationMm > 4) {
      score -= 35;
      reasons.push(`Heavy precipitation (${precipitationMm.toFixed(1)} mm/h)`);
    } else if (precipitationMm > 0.5) {
      score -= 15;
      reasons.push(`Light precipitation (${precipitationMm.toFixed(1)} mm/h)`);
    }

    if (visibilityKm < 3) {
      score -= 40;
      reasons.push(`Low visibility (${visibilityKm.toFixed(1)} km)`);
    } else if (visibilityKm < 8) {
      score -= 15;
      reasons.push(`Reduced visibility (${visibilityKm.toFixed(1)} km)`);
    }

    score = Math.max(0, Math.min(100, score));

    const verdict = score >= 70 ? 'good' : score >= 40 ? 'caution' : 'unsafe';
    if (reasons.length === 0) reasons.push('Clear conditions');

    return { score, windSpeedKmh, precipitationMm, visibilityKm, verdict, reasons };
  }
}