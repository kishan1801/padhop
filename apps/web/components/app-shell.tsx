"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Building2,
  Compass,
  CalendarDays,
  LayoutDashboard,
  MapPin,
  Menu,
  MessageCircle,
  Plane,
  ShieldCheck,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const passengerNavigation = [
  { href: "/", label: "Explore", icon: Compass },
  { href: "/#search", label: "Destinations", icon: MapPin },
  { href: "/#results", label: "Fleet", icon: Plane },
  { href: "/my-journeys", label: "My Journeys", icon: CalendarDays },
  { href: "/dashboard", label: "For Operators", icon: Building2 },
];

const secondaryNavigation = [
  { href: "/assistant", label: "Assistant", icon: MessageCircle },
  { href: "/admin", label: "Admin", icon: ShieldCheck },
];

const portalNavigation = [
  { href: "/", label: "Explore", icon: Compass },
  { href: "/my-journeys", label: "My Journeys", icon: CalendarDays },
  { href: "/dashboard", label: "Operator", icon: LayoutDashboard },
  ...secondaryNavigation,
];

const subscribeToHash = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

const getHashSnapshot = () => window.location.hash;
const getServerHashSnapshot = () => "";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const locationHash = useSyncExternalStore(
    subscribeToHash,
    getHashSnapshot,
    getServerHashSnapshot,
  );
  const [clickedHash, setClickedHash] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const hash = clickedHash ?? locationHash;
  const isPassengerHome = pathname === "/";
  const navigation = isPassengerHome
    ? [...passengerNavigation, ...secondaryNavigation]
    : portalNavigation;

  useEffect(() => {
    const resetClickedHash = () => setClickedHash(null);
    window.addEventListener("hashchange", resetClickedHash);
    window.addEventListener("popstate", resetClickedHash);

    return () => {
      window.removeEventListener("hashchange", resetClickedHash);
      window.removeEventListener("popstate", resetClickedHash);
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        menuToggleRef.current?.focus();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMenuOpen]);

  return (
    <div className="appShell">
      <header className="appNav">
        <Link className="brand" href="/" aria-label="PadHop home">
          <span className="brandMark">P</span>
          <span>PadHop</span>
        </Link>
        <nav
          id="primary-navigation"
          className={`appNavLinks${isMenuOpen ? " isOpen" : ""}`}
          aria-label="Primary navigation"
        >
          {navigation.map(({ href, label, icon: Icon }) => {
            const targetHash = href.includes("#") ? `#${href.split("#")[1]}` : "";
            const isActive = href === "/"
              ? pathname === "/" && !hash
              : targetHash
                ? pathname === "/" && hash === targetHash
                : pathname.startsWith(href);
            const isSecondary = isPassengerHome && secondaryNavigation.some((item) => item.href === href);

            return (
              <Link
                href={href}
                key={href}
                className={`navLink${isActive ? " active" : ""}${isSecondary ? " navLinkSecondary" : ""}`}
                aria-current={isActive ? (targetHash ? "location" : "page") : undefined}
                onClick={() => {
                  setIsMenuOpen(false);
                  setClickedHash(targetHash || (href === "/" ? "" : null));
                }}
              >
                <Icon aria-hidden="true" size={15} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="appNavActions">
          <button
            type="button"
            ref={menuToggleRef}
            className="mobileNavToggle"
            aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMenuOpen}
            aria-controls="primary-navigation"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            {isMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}
