export type PassengerBookingStatus =
  'held' | 'confirmed' | 'cancelled' | 'completed';

export interface PassengerBookingDto {
  bookingId: string;
  status: PassengerBookingStatus;
  price: number;
  createdAt: Date;
  slot: {
    startTime: Date;
    endTime: Date;
    aircraft: {
      model: string;
      capacity: number;
    };
    helipad: {
      name: string;
      city: string;
    };
  };
  destinationHelipad: {
    name: string;
    city: string;
  };
}
