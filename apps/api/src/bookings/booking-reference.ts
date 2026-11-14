import { randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SUFFIX_LENGTH = 8;

export function generateBookingReference(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = randomBytes(SUFFIX_LENGTH);
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `PH-${date}-${suffix}`;
}

export const BOOKING_REFERENCE_REGEX = /^PH-\d{8}-[A-HJ-NP-Z2-9]{8}$/;

export function isValidBookingReference(ref: string): boolean {
  return BOOKING_REFERENCE_REGEX.test(ref);
}
