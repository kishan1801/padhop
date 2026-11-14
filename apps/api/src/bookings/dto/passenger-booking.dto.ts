export type PassengerBookingStatus =
  'held' | 'confirmed' | 'cancelled' | 'completed';

export interface PassengerBookingDto {
  bookingId: string;
  reference: string;
  status: PassengerBookingStatus;
  price: number;
  createdAt: Date;
  slot: {
    startTime: Date;
    endTime: Date;
    aircraft: {
      model: string;
      capacity: number;
      registration: string | null;
    };
    operator: {
      companyName: string;
    } | null;
    helipad: {
      id: string;
      name: string;
      city: string;
    };
  };
  destinationHelipad: {
    id: string;
    name: string;
    city: string;
  } | null;
}
