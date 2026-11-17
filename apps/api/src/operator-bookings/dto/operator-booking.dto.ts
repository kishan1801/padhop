export interface OperatorBookingListQuery {
  status?: string;
  limit?: string;
  cursor?: string;
}

export interface OperatorBookingHelipadDto {
  id: string;
  name: string;
  city: string;
}

export interface OperatorBookingListItemDto {
  bookingId: string;
  reference: string;
  status: string;
  price: number;
  createdAt: Date;
  requestedAt: Date | null;
  decisionDeadline: Date | null;
  passengerName: string;
  origin: OperatorBookingHelipadDto;
  destination: OperatorBookingHelipadDto | null;
  slot: {
    startTime: Date;
    endTime: Date;
  };
  aircraft: {
    model: string;
    registration: string | null;
    capacity: number;
  };
}

export interface OperatorBookingDetailDto extends OperatorBookingListItemDto {
  acceptedAt: Date | null;
  declinedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  declineReason: string | null;
}

export interface OperatorBookingListResponseDto {
  items: OperatorBookingListItemDto[];
  nextCursor: string | null;
}

export interface DeclineBookingRequestDto {
  reason?: unknown;
}

export interface OperatorBookingDecisionDto extends OperatorBookingDetailDto {
  idempotent: boolean;
}
