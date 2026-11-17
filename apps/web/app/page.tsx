"use client";

import {
  FormEvent,
  useState,
  useRef,
  useEffect,
  useCallback,
  type CSSProperties,
} from "react";
import {
  MapPin,
  Plane,
  Clock,
  Users,
  Loader2,
  MessageCircle,
  ArrowRight,
  RotateCw,
} from "lucide-react";
import Image from "next/image";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion, useMotionValue, useSpring } from "motion/react";
import {
  formatHoldCountdown,
  getHoldSecondsRemaining,
  RequestSequence,
} from "@/lib/passenger-reliability";
import { HoldRequestGate, runGuardedHold } from "@/lib/hold-request";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiRequestError } from "@/lib/api-client";

type Helipad = {
  id: string;
  name: string;
  city: string;
  distance_km: number;
  available_slots: number;
};
type Slot = {
  id: string;
  startTime: string;
  aircraft: { model: string; capacity: number };
};
type HoldResponse = {
  bookingId: string;
  reference: string;
  price: number;
  expiresInSeconds: number;
};
type HeldBooking = {
  bookingId: string;
  reference: string;
  slot: Slot;
  price: number;
  expiresAt: number;
  helipadId: string;
  route?: {
    origin: HelipadOption;
    destination: HelipadOption;
    operatorName: string | null;
  } | null;
};

type PendingRouteHold = {
  slot: RouteSlot;
  route: {
    origin: HelipadOption;
    destination: HelipadOption;
  };
};

type ConfirmedRouteSummary = {
  reference: string;
  aircraftModel: string;
  origin: HelipadOption;
  destination: HelipadOption;
  operatorName: string | null;
};

type HelipadOption = {
  id: string;
  name: string;
  city: string;
};

type RouteSlot = {
  id: string;
  startTime: string;
  endTime: string;
  aircraft: {
    model: string;
    capacity: number;
    registration: string | null;
    operator: { companyName: string } | null;
  };
};

type RouteSearchResult = {
  origin: HelipadOption;
  destination: HelipadOption;
  slots: RouteSlot[];
};

const ROUTE_DISCLAIMER =
  "Availability is declared by the operator. PadHop does not dispatch or guarantee flights. Final journey coordination and operational acceptance remain with the licensed operator.";

function formatRouteTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

const holdPriceFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

type ResultCardProps = {
  helipad: Helipad;
  index: number;
  selectedHelipad: string | null;
  onSelect: (id: string) => void;
  loadingSlots: boolean;
  slotLoadError: boolean;
  slots: Slot[];
  prefersReducedMotion: boolean;
};

function ResultCard({
  helipad,
  index,
  selectedHelipad,
  onSelect,
  loadingSlots,
  slotLoadError,
  slots,
  prefersReducedMotion,
}: ResultCardProps) {
  const [hasHoverSupport, setHasHoverSupport] = useState(false);
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springX = useSpring(rotateX, { stiffness: 220, damping: 18, mass: 0.6 });
  const springY = useSpring(rotateY, { stiffness: 220, damping: 18, mass: 0.6 });

  useEffect(() => {
    const media = typeof window !== "undefined" ? window.matchMedia("(hover: hover) and (pointer: fine)") : null;
    if (!media) return;

    const syncHoverSupport = () => setHasHoverSupport(media.matches);
    syncHoverSupport();
    media.addEventListener("change", syncHoverSupport);

    return () => media.removeEventListener("change", syncHoverSupport);
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (prefersReducedMotion || !hasHoverSupport) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 10;
    const y = -((event.clientY - rect.top) / rect.height - 0.5) * 10;

    rotateY.set(x);
    rotateX.set(y);
  };

  const handlePointerLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.article
      key={helipad.id}
      className="card tilt-card"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: prefersReducedMotion ? 0.01 : 0.35,
        ease: "easeOut",
        delay: prefersReducedMotion ? 0 : index * 0.06,
      }}
      whileHover={prefersReducedMotion || !hasHoverSupport ? undefined : { y: -3, scale: 1.01, borderColor: "var(--brass)" }}
      style={{ rotateX: springX, rotateY: springY, transformPerspective: 1000 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="cardTop">
        <div className="cardIcon">
          <Plane size={20} />
        </div>
        <div className="cardMain">
          <h2>{helipad.name}</h2>
          <p className="cardCity">
            <MapPin size={13} /> {helipad.city} · {helipad.distance_km.toFixed(1)} km away
          </p>
        </div>
        <Badge variant={helipad.available_slots > 0 ? "default" : "secondary"} className={helipad.available_slots > 0 ? "pulse-badge" : ""}>
          {helipad.available_slots} {helipad.available_slots === 1 ? "charter" : "charters"}
        </Badge>
      </div>
      <button className="searchButtonSecondary fullWidth magnetic" onClick={() => onSelect(helipad.id)}>
        <span className="btnContent">{selectedHelipad === helipad.id ? "Refresh flights" : "View flights"}</span>
        <span className="btnRipple" aria-hidden="true" />
      </button>
      <AnimatePresence initial={false} mode="wait">
        {selectedHelipad === helipad.id ? (
          <motion.div
            key={loadingSlots ? `slots-loading-${helipad.id}` : `slots-${helipad.id}`}
            initial={prefersReducedMotion ? false : { opacity: 0, height: 0, y: 6 }}
            animate={prefersReducedMotion ? { opacity: 1, height: "auto", y: 0 } : { opacity: 1, height: "auto", y: 0 }}
            exit={prefersReducedMotion ? { opacity: 1, height: "auto", y: 0 } : { opacity: 0, height: 0, y: -6 }}
            transition={{ duration: prefersReducedMotion ? 0.01 : 0.26, ease: "easeOut" }}
            className="slotList"
            aria-live="polite"
          >
            {loadingSlots ? (
              <div className="slotSkeleton" role="status" aria-live="polite" aria-label="Loading available flights">
                <span className="skeleton-line skeleton-line-long" />
                <span className="skeleton-line skeleton-line-medium" />
                <span className="skeleton-line skeleton-line-short" />
              </div>
            ) : slots.length === 0 ? (
              <p>
                {slotLoadError
                  ? "Could not load aircraft. Please refresh to try again."
                  : "No aircraft are available at this helipad now."}
              </p>
            ) : (
              <>
                {slots.map((slot, si) => (
                <motion.div
                  key={slot.id}
                  className="slot"
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0.01 : 0.24, ease: "easeOut", delay: prefersReducedMotion ? 0 : si * 0.05 }}
                >
                  <div className="slotInfo">
                    <strong>{slot.aircraft.model}</strong>
                    <span>
                      <Clock size={13} />{" "}
                      {new Date(slot.startTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      {" · "}
                      <Users size={13} /> {slot.aircraft.capacity} seats
                    </span>
                  </div>
                </motion.div>
                ))}
                <p className="slotRouteNote">
                  Nearby results show origin-only availability. Search a specific
                  origin and destination above to request a journey.
                </p>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}

export default function SearchPage() {
  const { user, login, signup, refresh } = useAuth();
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [noticeKind, setNoticeKind] = useState<"error" | "success" | null>(null);
  const [results, setResults] = useState<Helipad[]>([]);
  const [radiusKm, setRadiusKm] = useState(50);
  const [selectedHelipad, setSelectedHelipad] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotLoadError, setSlotLoadError] = useState(false);
  const [pendingRouteHold, setPendingRouteHold] =
    useState<PendingRouteHold | null>(null);
  const [lastConfirmation, setLastConfirmation] =
    useState<ConfirmedRouteSummary | null>(null);
  const [heldBooking, setHeldBooking] = useState<HeldBooking | null>(null);
  const [holdSecondsRemaining, setHoldSecondsRemaining] = useState<number | null>(null);
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const prefersReducedMotion = useReducedMotion() ?? false;
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [holdingSlotId, setHoldingSlotId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const authPanelRef = useRef<HTMLDivElement>(null);
  const searchRequests = useRef(new RequestSequence());
  const slotRequests = useRef(new RequestSequence());
  const searchAbortController = useRef<AbortController | null>(null);
  const slotAbortController = useRef<AbortController | null>(null);
  const selectedHelipadRef = useRef<string | null>(null);
  const holdRequestGate = useRef(new HoldRequestGate());

  const [helipadOptions, setHelipadOptions] = useState<HelipadOption[]>([]);
  const [helipadStatus, setHelipadStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [routeStatus, setRouteStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<RouteSearchResult | null>(null);
  const [lastRoute, setLastRoute] = useState<{
    originId: string;
    destinationId: string;
  } | null>(null);
  const routeRequests = useRef(new RequestSequence());
  const routeAbortController = useRef<AbortController | null>(null);
  const helipadAbortController = useRef<AbortController | null>(null);

  const loadHelipads = useCallback(async () => {
    helipadAbortController.current?.abort();
    const controller = new AbortController();
    helipadAbortController.current = controller;
    setHelipadStatus("loading");
    try {
      const list = await apiFetch<HelipadOption[]>("/api/helipads", {
        cache: "no-store",
        signal: controller.signal,
      });
      setHelipadOptions(list);
      setHelipadStatus("ready");
    } catch (error) {
      if (isAbortError(error)) return;
      setHelipadOptions([]);
      setHelipadStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadHelipads();
    return () => helipadAbortController.current?.abort();
  }, [loadHelipads]);

  const searchRoute = useCallback(
    async (origin: string, destination: string) => {
      const requestId = routeRequests.current.next();
      routeAbortController.current?.abort();
      const controller = new AbortController();
      routeAbortController.current = controller;
      setLastRoute({ originId: origin, destinationId: destination });
      setRouteStatus("loading");
      setRouteError(null);
      try {
        const params = new URLSearchParams({
          originId: origin,
          destinationId: destination,
        });
        const result = await apiFetch<RouteSearchResult>(
          `/api/helipads/search?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!routeRequests.current.isCurrent(requestId)) return;
        setRouteResult(result);
        setRouteStatus("done");
      } catch (error) {
        if (!routeRequests.current.isCurrent(requestId) || isAbortError(error)) {
          return;
        }
        setRouteResult(null);
        setRouteStatus("error");
        if (error instanceof ApiRequestError && error.status === 404) {
          setRouteError(
            "One of the selected helipads is no longer available. The helipad list has been refreshed.",
          );
          void loadHelipads();
        } else {
          setRouteError(
            error instanceof Error
              ? error.message
              : "Could not search availability for this route.",
          );
        }
      } finally {
        if (
          routeRequests.current.isCurrent(requestId) &&
          routeAbortController.current === controller
        ) {
          routeAbortController.current = null;
        }
      }
    },
    [loadHelipads],
  );

  function submitRouteSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (routeStatus === "loading") return;
    if (!originId || !destinationId) {
      setRouteStatus("error");
      setRouteError("Select both an origin and a destination helipad.");
      return;
    }
    if (originId === destinationId) {
      setRouteStatus("error");
      setRouteError("Origin and destination must be different helipads.");
      return;
    }
    void searchRoute(originId, destinationId);
  }

  function retryRouteSearch() {
    if (!lastRoute || routeStatus === "loading") return;
    void searchRoute(lastRoute.originId, lastRoute.destinationId);
  }

  const destinationOptions = helipadOptions.filter(
    (helipad) => helipad.id !== originId,
  );
  const routeFormInvalid =
    !originId || !destinationId || originId === destinationId;

  useEffect(() => {
    if (pendingRouteHold && !user) {
      authPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [pendingRouteHold, user]);

  useEffect(
    () => () => {
      searchRequests.current.next();
      slotRequests.current.next();
      routeRequests.current.next();
      searchAbortController.current?.abort();
      slotAbortController.current?.abort();
      routeAbortController.current?.abort();
      helipadAbortController.current?.abort();
    },
    [],
  );

  function showError(text: string) {
    setMessage(text);
    setNoticeKind("error");
  }

  function clearNotice() {
    setMessage("");
    setNoticeKind(null);
  }

  function beginSearch() {
    const requestId = searchRequests.current.next();
    searchAbortController.current?.abort();
    searchAbortController.current = null;
    slotRequests.current.next();
    slotAbortController.current?.abort();
    slotAbortController.current = null;
    selectedHelipadRef.current = null;
    setStatus("loading");
    clearNotice();
    setResults([]);
    setSelectedHelipad(null);
    setSlots([]);
    setLoadingSlots(false);
    setSlotLoadError(false);
    return requestId;
  }

  async function runSearch(
    lat: number,
    lng: number,
    requestId = beginSearch(),
  ) {
    if (!searchRequests.current.isCurrent(requestId)) return;
    const controller = new AbortController();
    searchAbortController.current = controller;

    try {
      const nextResults = await apiFetch<Helipad[]>(
        `/api/helipads/nearest?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`,
        { signal: controller.signal },
      );
      if (!searchRequests.current.isCurrent(requestId)) return;
      setResults(nextResults);
      setStatus("done");
    } catch (error) {
      if (!searchRequests.current.isCurrent(requestId) || isAbortError(error)) return;
      showError(error instanceof Error ? error.message : "Search failed");
      setStatus("error");
    } finally {
      if (
        searchRequests.current.isCurrent(requestId) &&
        searchAbortController.current === controller
      ) {
        searchAbortController.current = null;
      }
    }
  }

  function nearMe() {
    const requestId = beginSearch();
    if (!navigator.geolocation) {
      showError("Location services are not supported in this browser.");
      setStatus("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (searchRequests.current.isCurrent(requestId)) {
          void runSearch(
            position.coords.latitude,
            position.coords.longitude,
            requestId,
          );
        }
      },
      () => {
        if (!searchRequests.current.isCurrent(requestId)) return;
        showError("We couldn't access your location. Try the Bengaluru demo instead.");
        setStatus("error");
      },
    );
  }

  const showSlots = useCallback(async (id: string, preserveNotice = false) => {
    const requestId = slotRequests.current.next();
    slotAbortController.current?.abort();
    const controller = new AbortController();
    slotAbortController.current = controller;
    selectedHelipadRef.current = id;
    setSelectedHelipad(id);
    setSlots([]);
    setLoadingSlots(true);
    setSlotLoadError(false);
    if (!preserveNotice) {
      setMessage("");
      setNoticeKind(null);
    }
    try {
      const nextSlots = await apiFetch<Slot[]>(`/api/helipads/${id}/slots`, {
        signal: controller.signal,
      });
      if (!slotRequests.current.isCurrent(requestId)) return;
      setSlots(nextSlots);
    } catch (error) {
      if (!slotRequests.current.isCurrent(requestId) || isAbortError(error)) return;
      setSlotLoadError(true);
      setMessage(error instanceof Error ? error.message : "Could not load aircraft.");
      setNoticeKind("error");
    } finally {
      if (
        slotRequests.current.isCurrent(requestId) &&
        slotAbortController.current === controller
      ) {
        slotAbortController.current = null;
        setLoadingSlots(false);
      }
    }
  }, []);

  const expireHeldBooking = useCallback(
    (booking: HeldBooking) => {
      const expiryMessage =
        "This hold has expired. Please select an available flight again.";
      setHeldBooking((current) =>
        current?.bookingId === booking.bookingId ? null : current,
      );
      setHoldSecondsRemaining(null);
      setMessage(expiryMessage);
      setNoticeKind("error");
      if (booking.route) {
        void searchRoute(
          booking.route.origin.id,
          booking.route.destination.id,
        ).finally(() => {
          setMessage(expiryMessage);
          setNoticeKind("error");
        });
        return;
      }
      if (
        booking.helipadId &&
        selectedHelipadRef.current === booking.helipadId
      ) {
        void showSlots(booking.helipadId, true).finally(() => {
          setMessage(expiryMessage);
          setNoticeKind("error");
        });
      }
    },
    [showSlots, searchRoute],
  );

  useEffect(() => {
    if (!heldBooking) return;

    const interval = window.setInterval(() => {
      const remaining = getHoldSecondsRemaining(heldBooking.expiresAt);
      setHoldSecondsRemaining(remaining);
      if (remaining === 0) {
        window.clearInterval(interval);
        void expireHeldBooking(heldBooking);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [heldBooking, expireHeldBooking]);

  async function holdRoute(
    slot: RouteSlot,
    route: { origin: HelipadOption; destination: HelipadOption },
  ) {
    if (!user) {
      setPendingRouteHold({ slot, route });
      return;
    }
    if (heldBooking !== null) return;

    const requestedAt = Date.now();
    await runGuardedHold({
      gate: holdRequestGate.current,
      slotId: slot.id,
      onStart: () => {
        setHoldingSlotId(slot.id);
        setLastConfirmation(null);
        clearNotice();
      },
      request: async () => {
        const response = await apiFetch<HoldResponse>(
          `/api/bookings/hold/${slot.id}`,
          {
            method: "POST",
            body: JSON.stringify({
              destinationHelipadId: route.destination.id,
            }),
          },
        );
        if (
          !response.bookingId ||
          !Number.isFinite(response.price) ||
          response.price < 0 ||
          !Number.isFinite(response.expiresInSeconds) ||
          response.expiresInSeconds <= 0
        ) {
          throw new Error("The server returned an invalid hold.");
        }
        const expiresAt = requestedAt + response.expiresInSeconds * 1000;
        if (expiresAt <= Date.now()) {
          void searchRoute(route.origin.id, route.destination.id);
          throw new Error(
            "This hold has already expired. Please select another flight.",
          );
        }
        return { response, expiresAt };
      },
      onSuccess: ({ response, expiresAt }) => {
        setHeldBooking({
          bookingId: response.bookingId,
          reference: response.reference,
          slot,
          price: response.price,
          expiresAt,
          helipadId: route.origin.id,
          route: {
            origin: route.origin,
            destination: route.destination,
            operatorName: slot.aircraft.operator?.companyName ?? null,
          },
        });
        setHoldSecondsRemaining(getHoldSecondsRemaining(expiresAt));
        setPendingRouteHold(null);
      },
      onUnavailable: () => {
        showError(
          "This flight is no longer available. Availability for this route has been refreshed.",
        );
        void searchRoute(route.origin.id, route.destination.id);
      },
      onError: (error) => {
        if (error instanceof ApiRequestError && error.status === 401) {
          setPendingRouteHold({ slot, route });
          showError("Your session expired. Sign in again to hold this route.");
          void refresh();
          return;
        }
        showError(
          error instanceof Error ? error.message : "Could not hold this route.",
        );
      },
      onFinally: () => {
        setHoldingSlotId((current) => (current === slot.id ? null : current));
      },
    });
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthSubmitting(true);
    clearNotice();
    try {
      if (authMode === "signup") {
        await signup(
          String(form.get("name")),
          String(form.get("email")),
          String(form.get("password")),
        );
      } else {
        await login(String(form.get("email")), String(form.get("password")));
      }
      if (pendingRouteHold) {
        await holdRoute(pendingRouteHold.slot, pendingRouteHold.route);
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function confirm() {
    if (!user || !heldBooking || confirming) return;
    if (Date.now() >= heldBooking.expiresAt) {
      expireHeldBooking(heldBooking);
      return;
    }

    setConfirming(true);
    clearNotice();
    try {
      await apiFetch<unknown>(`/api/bookings/confirm/${heldBooking.slot.id}`, {
        method: "POST",
      });
      setHeldBooking(null);
      setHoldSecondsRemaining(null);
      if (heldBooking.route) {
        setLastConfirmation({
          reference: heldBooking.reference,
          aircraftModel: heldBooking.slot.aircraft.model,
          origin: heldBooking.route.origin,
          destination: heldBooking.route.destination,
          operatorName: heldBooking.route.operatorName,
        });
        await searchRoute(
          heldBooking.route.origin.id,
          heldBooking.route.destination.id,
        );
      } else if (selectedHelipadRef.current === heldBooking.helipadId) {
        await showSlots(heldBooking.helipadId);
      }
      setMessage("Your booking is confirmed in PadHop. This does not indicate operator acceptance, payment, or flight approval.");
      setNoticeKind("success");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Could not confirm this charter.";
      if (error instanceof ApiRequestError && error.status === 409) {
        setHeldBooking(null);
        setHoldSecondsRemaining(null);
        showError(errorMessage);
        if (heldBooking.route) {
          void searchRoute(
            heldBooking.route.origin.id,
            heldBooking.route.destination.id,
          );
        } else if (selectedHelipadRef.current === heldBooking.helipadId) {
          void showSlots(heldBooking.helipadId, true).finally(() =>
            showError(errorMessage),
          );
        }
      } else {
        showError(errorMessage);
      }
    } finally {
      setConfirming(false);
    }
  }

  return (
    <AppShell>
      <main className="page">
        <Link href="/assistant" className="chatFab" aria-label="Chat with PadHop Assistant">
          <MessageCircle size={22} />
        </Link>

        {/* Animated background particles */}
        <div className="heroParticles" aria-hidden="true">
          {[...Array(12)].map((_, i) => (
            <span key={i} className="particle" style={{ animationDelay: `${i * 1.5}s`, '--i': i } as CSSProperties} />
          ))}
        </div>

        <section className="hero">
          <div className="heroVisual" aria-hidden="true">
            <Image
              src="/images/hero-helicopter.png"
              alt=""
              fill
              priority
              sizes="100vw"
              className="heroImage"
            />
          </div>
          <div className="heroContent">
            <motion.p
              className="eyebrow"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.45, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.08 }}
            >
              PadHop
            </motion.p>
            <motion.h1
              className="heroHeadline"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.5, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.14 }}
            >
              <span className="word">India, Closer</span>
              <span className="word highlight">from Above.</span>
            </motion.h1>
            <motion.p
              className="subhead"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.45, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.22 }}
            >
              Discover and coordinate helicopter journeys across India. Connect with operators, aircraft and landing locations.
            </motion.p>
            <motion.div
              className="heroCtas"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.4, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.28 }}
            >
              <a href="#search" className="searchButton magnetic">
                <span className="btnContent">Search Flights</span>
              </a>
              <Link href="/dashboard" className="searchButtonSecondary magnetic">
                <span className="btnContent">For Operators</span>
              </Link>
            </motion.div>
            <motion.div
              id="search"
              className="searchPanel"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.5, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.34 }}
            >
              <div className="field">
                <label htmlFor="radius">Search radius</label>
                <select id="radius" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="animatedInput">
                  <option value={10}>10 km</option>
                  <option value={25}>25 km</option>
                  <option value={50}>50 km</option>
                  <option value={100}>100 km</option>
                </select>
              </div>
              <button className="searchButton magnetic" onClick={nearMe} disabled={status === "loading"}>
                <span className="btnContent">
                  {status === "loading" ? <> <Loader2 size={16} className="spin" /> Searching</> : "Search near me"}
                </span>
                <span className="btnRipple" aria-hidden="true" />
              </button>
              <button
                className="searchButtonSecondary magnetic"
                onClick={() => runSearch(12.9716, 77.5946)}
                disabled={status === "loading"}
              >
                <span className="btnContent">Try Bengaluru</span>
                <span className="btnRipple" aria-hidden="true" />
              </button>
            </motion.div>

            <motion.div
              id="route-search"
              className="routePanelWrap"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.5, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.4 }}
            >
              <p className="eyebrow routeEyebrow">Plan a route</p>
              <form className="searchPanel routePanel" onSubmit={submitRouteSearch}>
                <div className="field">
                  <label htmlFor="route-origin">Origin helipad</label>
                  <select
                    id="route-origin"
                    value={originId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setOriginId(value);
                      if (destinationId === value) setDestinationId("");
                    }}
                    disabled={helipadStatus !== "ready"}
                  >
                    <option value="">Select origin</option>
                    {helipadOptions.map((helipad) => (
                      <option key={helipad.id} value={helipad.id}>
                        {helipad.name} · {helipad.city}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="route-destination">Destination helipad</label>
                  <select
                    id="route-destination"
                    value={destinationId}
                    onChange={(event) => setDestinationId(event.target.value)}
                    disabled={helipadStatus !== "ready" || !originId}
                  >
                    <option value="">Select destination</option>
                    {destinationOptions.map((helipad) => (
                      <option key={helipad.id} value={helipad.id}>
                        {helipad.name} · {helipad.city}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="searchButton magnetic routeSearchButton"
                  type="submit"
                  disabled={
                    routeStatus === "loading" ||
                    routeFormInvalid ||
                    helipadStatus !== "ready"
                  }
                >
                  <span className="btnContent">
                    {routeStatus === "loading" ? (
                      <>
                        <Loader2 size={16} className="spin" /> Searching
                      </>
                    ) : (
                      "Search route"
                    )}
                  </span>
                  <span className="btnRipple" aria-hidden="true" />
                </button>
              </form>
              {helipadStatus === "loading" && (
                <p className="hint routePanelHint">Loading helipads…</p>
              )}
              {helipadStatus === "error" && (
                <div className="routeErrorState" role="alert">
                  <p className="hint error">Could not load helipads. Please try again.</p>
                  <button
                    className="searchButtonSecondary"
                    type="button"
                    onClick={() => void loadHelipads()}
                  >
                    <RotateCw size={14} aria-hidden="true" /> Retry
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        </section>

        {pendingRouteHold && !user && (
          <section className="authPanel" ref={authPanelRef}>
            <p className="eyebrow">One last step</p>
            <h2>{authMode === "signup" ? "Create your passenger account" : "Welcome back"}</h2>
            <p>Sign in to place a temporary hold on this aircraft.</p>
            <form onSubmit={submitAuth}>
              {authMode === "signup" && <input name="name" required placeholder="Your name" />}
              <input name="email" type="email" required placeholder="Email address" />
              <input name="password" type="password" minLength={8} required placeholder="Password" />
              <button className="searchButton" disabled={authSubmitting}>
                {authSubmitting ? "Please wait…" : authMode === "signup" ? "Create account & hold" : "Sign in & hold"}
              </button>
              <button
                type="button"
                className="textButton"
                onClick={() => setAuthMode(authMode === "signup" ? "login" : "signup")}
              >
                {authMode === "signup" ? "Already have an account? Sign in" : "New to PadHop? Create an account"}
              </button>
            </form>
          </section>
        )}

        {heldBooking && (
          <section className="holdPanel" aria-label="Booking hold">
            <div>
              <p className="eyebrow">Aircraft held</p>
              <h2><Plane size={18} /> {heldBooking.slot.aircraft.model}</h2>
              {heldBooking.route && (
                <p className="holdRoute">
                  <MapPin size={14} aria-hidden="true" />
                  <strong>{heldBooking.route.origin.name}</strong>
                  <ArrowRight size={14} aria-hidden="true" />
                  <strong>{heldBooking.route.destination.name}</strong>
                  <span className="holdRouteOperator">
                    · {heldBooking.route.operatorName ?? "Operator not listed"}
                  </span>
                </p>
              )}
              <p>
                This hold expires in{" "}
                <span aria-live="off">
                  {formatHoldCountdown(holdSecondsRemaining ?? 0)}
                </span>
                .
              </p>
              <p>
                Estimated charter price (PadHop estimate, not an operator
                quote):{" "}
                <strong>{holdPriceFormatter.format(heldBooking.price)}</strong>
              </p>
            </div>
            <button className="searchButton" onClick={confirm} disabled={confirming}>
              {confirming ? "Confirming…" : "Confirm charter"}
            </button>
          </section>
        )}

        {lastConfirmation && (
          <section className="holdPanel" aria-label="Booking confirmation">
            <div>
              <p className="eyebrow">Journey requested</p>
              <h2><Plane size={18} /> {lastConfirmation.aircraftModel}</h2>
              <p className="holdRoute">
                <MapPin size={14} aria-hidden="true" />
                <strong>{lastConfirmation.origin.name}</strong>
                <ArrowRight size={14} aria-hidden="true" />
                <strong>{lastConfirmation.destination.name}</strong>
                <span className="holdRouteOperator">
                  · {lastConfirmation.operatorName ?? "Operator not listed"}
                </span>
              </p>
              <p>
                Booking reference: <code>{lastConfirmation.reference}</code>
              </p>
              <p>
                This is a PadHop booking record. It does not indicate operator
                acceptance, payment, or flight approval.
              </p>
            </div>
          </section>
        )}

        {message && (
          <p
            className={`notice ${noticeKind === "error" ? "error" : ""}`}
            role={noticeKind === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        )}

        <section id="route-results" className="results routeResults" aria-live="polite">
          {routeStatus === "idle" && (
            <p className="hint">
              Select an origin and destination to see operator-declared availability.
            </p>
          )}
          {routeStatus === "loading" && (
            <p className="hint routeLoading">
              <Loader2 size={16} className="spin" aria-hidden="true" /> Searching
              operator availability for this route…
            </p>
          )}
          {routeStatus === "error" && (
            <div className="routeErrorState" role="alert">
              <p className="hint error">{routeError}</p>
              <button
                className="searchButtonSecondary"
                type="button"
                onClick={retryRouteSearch}
                disabled={!lastRoute}
              >
                <RotateCw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {routeStatus === "done" && routeResult && (
            <>
              <p className="hint routeHeadline">
                <strong>{routeResult.origin.name}</strong>
                <ArrowRight size={14} aria-hidden="true" />
                <strong>{routeResult.destination.name}</strong>
                <span className="routeHeadlineCities">
                  {routeResult.origin.city} to {routeResult.destination.city}
                </span>
              </p>
              {routeResult.slots.length === 0 ? (
                <p className="hint">
                  No operator-declared availability for this route right now. Try a
                  different route or check again later.
                </p>
              ) : (
                <div className="routeSlotList">
                  {routeResult.slots.map((routeSlot) => (
                    <article key={routeSlot.id} className="card routeSlotCard">
                      <div className="cardTop">
                        <div className="cardIcon">
                          <Plane size={20} />
                        </div>
                        <div className="cardMain">
                          <h2>{routeSlot.aircraft.model}</h2>
                          <p className="routeOperator">
                            {routeSlot.aircraft.operator?.companyName ??
                              "Operator not listed"}
                          </p>
                          <p className="cardCity">
                            <MapPin size={13} /> {routeResult.origin.name} to{" "}
                            {routeResult.destination.name}
                          </p>
                        </div>
                        <Badge variant="default">Available</Badge>
                      </div>
                      <div className="routeSlotMeta">
                        <span>
                          <Clock size={13} />{" "}
                          {formatRouteTime(routeSlot.startTime)} –{" "}
                          {formatRouteTime(routeSlot.endTime)}
                        </span>
                        <span>
                          <Users size={13} /> {routeSlot.aircraft.capacity} seats
                        </span>
                        {routeSlot.aircraft.registration && (
                          <span>Registration: {routeSlot.aircraft.registration}</span>
                        )}
                      </div>
                      <div className="routeSlotActions">
                        <button
                          className="searchButton magnetic"
                          onClick={() =>
                            holdRoute(routeSlot, {
                              origin: routeResult.origin,
                              destination: routeResult.destination,
                            })
                          }
                          disabled={holdingSlotId !== null || heldBooking !== null}
                        >
                          <span className="btnContent">
                            {holdingSlotId === routeSlot.id
                              ? "Holding…"
                              : heldBooking
                                ? "Hold active"
                                : "Hold this route"}
                          </span>
                          <span className="btnRipple" aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <p className="routeDisclaimer">{ROUTE_DISCLAIMER}</p>
            </>
          )}
        </section>

        <section id="results" className="results" aria-live="polite">
          {status === "idle" && (
            <p className="hint">Search near you, or try Bengaluru to see live demo availability.</p>
          )}
          {status === "done" && results.length === 0 && (
            <p className="hint">No charters are available nearby right now. Try a wider search radius.</p>
          )}
          {status === "done" && results.length > 0 && (
            <p className="hint charterCount">
              <motion.span
                key={results.length}
                initial={prefersReducedMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: prefersReducedMotion ? 0.01 : 0.3, ease: "easeOut" }}
                className="charterCountValue"
              >
                {results.length}
              </motion.span>
              {" "}
              {results.length === 1 ? "helipad" : "helipads"} found
            </p>
          )}
          {results.map((helipad, i) => (
            <ResultCard
              key={helipad.id}
              helipad={helipad}
              index={i}
              selectedHelipad={selectedHelipad}
              onSelect={showSlots}
              loadingSlots={loadingSlots}
              slotLoadError={slotLoadError}
              slots={slots}
              prefersReducedMotion={prefersReducedMotion}
            />
          ))}
        </section>
      </main>
    </AppShell>
  );
}
