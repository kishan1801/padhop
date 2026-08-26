PadHop — Engineering Build Roadmap

Project status: Building
Product: AI-powered helicopter charter and helipad booking platform
Development model: 16 weeks · 2-week sprints · demoable increments
Primary goal: Build a production-style marketplace system that demonstrates full-stack engineering, real-time systems, geospatial search, concurrency, payments, and practical AI.

1. Product Vision

PadHop is an Uber/Ola-style platform for helicopter charter and helipad booking.

Unlike a car marketplace, helicopters cannot pick up passengers at arbitrary GPS coordinates. PadHop therefore matches passengers with fixed helipads near their location, then matches those helipads with available aircraft.

Core user roles

Role

Responsibilities

Passenger

Search routes, view nearby helipads, book, pay, track flights

Operator

Manage aircraft, pilots, availability, bookings and fleet

Admin

Verify operators, monitor platform activity, analytics and disputes

V1 booking modes

Now

Find nearby eligible helipads

Find available aircraft/slots

Rank options by distance, price and wait time

Temporarily hold the selected slot

Confirm after payment

Reserve

Search future aircraft availability

Select a future slot

Hold the slot during confirmation

Confirm the scheduled booking

2. Engineering Goals

This project is intentionally designed to demonstrate more than CRUD.

Core engineering problems

Geospatial nearest-helipad search

Availability as a state machine

Concurrent booking protection

Redis-based temporary holds

Real-time booking and flight updates

Dynamic pricing based on supply/demand signals

Weather-aware route feasibility

Role-based authentication and authorization

Payment processing

Operator and admin workflows

Automated testing

CI/CD and deployment

Architecture documentation and ADRs

The matching engine is the technical center of the system.

3. V1 Scope

Included

Passenger / Operator / Admin authentication

JWT authentication

Google OAuth

Helipad management

Aircraft management

Geospatial nearest-helipad matching

Now booking

Reserve booking

Temporary booking holds

Booking confirmation

AI trip assistant

AI-assisted dynamic pricing

Weather-risk scoring

Simulated live flight tracking

Razorpay payments

Operator dashboard

Admin dashboard

API documentation

Automated tests

CI/CD

Error monitoring

Explicitly deferred

The following are documented as future work rather than being forced into V1:

Real ADS-B / live GPS integration

Multi-currency and international operations

Passenger/operator in-app chat

Native push notifications

4. Technology Architecture

Layer

Technology

Web

React + TypeScript + Vite

Styling

TailwindCSS

Web data

React Query

Client state

Zustand

Mobile

React Native + Expo

Backend

NestJS + Node.js + TypeScript

Database

PostgreSQL

Geospatial

PostGIS

ORM

Prisma

Cache / locks / pub-sub

Redis

Realtime

Socket.IO

AI service

Python + FastAPI

Maps

Mapbox GL JS

Payments

Razorpay

Local infrastructure

Docker Compose

Web deployment

Vercel

API / DB deployment

Render / Railway

Mobile builds

EAS

CI/CD

GitHub Actions

API tests

Jest + Supertest

Web tests

React Testing Library

E2E

Playwright

Monitoring

Sentry

API documentation

OpenAPI / Swagger

Project management

GitHub Projects

5. Monorepo Structure

padhop/
├── apps/
│ ├── web/ # React web application
│ ├── mobile/ # React Native / Expo
│ ├── api/ # NestJS backend
│ └── ai-service/ # Python FastAPI AI services
│
├── packages/
│ ├── shared-types/ # Shared TypeScript types
│ └── ui/ # Shared UI primitives
│
├── docs/
│ ├── architecture/
│ ├── api/
│ └── decisions/
│
├── .github/
│ ├── workflows/
│ └── ISSUE_TEMPLATE/
│
└── docker-compose.yml

6. Core Domain Model

The first version should establish these main entities:

User
├── Passenger
├── Operator
└── Admin

Operator
└── Aircraft
└── Availability Slot

Helipad
├── Location
└── Routes

Passenger
└── Booking
├── Payment
└── Flight Status

The exact ERD should be finalized during Phase 0 before implementation begins.

7. Matching Engine

7.1 Problem

Given a passenger location and requested route, PadHop must find suitable helipads and aircraft while considering:

Distance

Aircraft availability

Price

Wait time

Route feasibility

7.2 Version 1 — PostGIS

Start with PostgreSQL + PostGIS.

The first implementation will use spatial queries such as:

Find helipads within N kilometres
↓
Filter by route / availability
↓
Calculate distance
↓
Rank candidates
↓
Return best options

This is the baseline implementation because it is straightforward, correct and easy to measure.

7.3 Version 2 — H3 optimization

After the PostGIS implementation works, benchmark it.

Then evaluate H3-based indexing:

Passenger location
↓
H3 cell
↓
Neighbouring cells
↓
Candidate helipads
↓
Availability filtering
↓
Ranking

The purpose is not to add technology for appearance. The purpose is to demonstrate an actual optimization decision backed by measurements.

8. Booking State Machine

Every aircraft/booking slot follows a controlled lifecycle:

AVAILABLE
↓
HELD
↓
CONFIRMED
↓
IN_FLIGHT
↓
COMPLETED

Alternative exits:

HELD → EXPIRED
HELD → CANCELLED
CONFIRMED → CANCELLED

Why this matters

The state machine prevents the booking logic from becoming a collection of unrelated boolean flags.

It also creates a clear foundation for:

Now bookings

Reserve bookings

Payment confirmation

Flight status

Cancellation

Expiry

9. Double-Booking Protection

This is one of the most important backend problems in PadHop.

Target flow

User A searches ──┐
├── Same aircraft slot
User B searches ──┘
↓
First user selects
↓
Redis HOLD / TTL
↓
┌──────────┴──────────┐
↓ ↓
Payment succeeds Hold expires
↓ ↓
CONFIRMED AVAILABLE

The hold must be temporary.

A Redis lock/hold with a short TTL prevents two users from confirming the same slot while payment is being completed.

Test case

At minimum, the automated test suite must prove:

Two simultaneous booking attempts cannot successfully confirm the same aircraft slot.

This concurrency test is a priority before declaring the booking engine complete.

10. Realtime Architecture

Live flight tracking is simulated rather than connected to real aircraft telemetry.

Flight lifecycle

CONFIRMED
↓
BOARDING
↓
DEPARTED
↓
EN_ROUTE
↓
LANDED

Socket.IO broadcasts state changes to connected clients.

Example:

Backend
↓
Flight status event
↓
Socket.IO
↓
Passenger web/mobile client
↓
Live UI update

This provides practical realtime-system experience without requiring real aviation telemetry.

11. AI Layer

AI is used where it solves a product problem.

AI Trip Assistant

The assistant should answer questions such as:

Which route should I take?

Can I fly to a destination on a particular date?

What options are available?

What factors could affect the trip?

It should use PadHop's actual application data rather than behaving as an isolated generic chatbot.

Dynamic Pricing

Pricing uses live platform signals such as:

Available slots +
Active searches / holds +
Weather conditions +
Fuel-cost signal
↓
Pricing calculation
↓
Suggested booking price

The first version should be understandable and measurable rather than an unnecessarily complex ML system.

Weather Risk

The AI service receives route/weather information and returns a feasibility/risk score.

Example concept:

Route

- Weather data
- Flight conditions
  ↓
  Risk scoring service
  ↓
  LOW / MEDIUM / HIGH

12. API Architecture

NestJS will organize the backend into domain modules.

Expected modules:

AuthModule
UsersModule
OperatorsModule
AircraftModule
HelipadsModule
AvailabilityModule
MatchingModule
BookingsModule
PaymentsModule
FlightsModule
NotificationsModule
AdminModule

The AI service remains a separate FastAPI application.

React / Mobile
↓
NestJS API
↓
┌────┴─────────────────────┐
↓ ↓
PostgreSQL + PostGIS Redis

NestJS
↓
FastAPI AI Service

Swagger/OpenAPI will document the public API.

13. Development Roadmap

Phase 0 — Discovery & Design

Week 1

Deliverables

User personas

User stories

Acceptance criteria

Initial ERD

System architecture diagram

Low-fidelity wireframes

Monorepo scaffold

GitHub Projects board

Development conventions

Exit criteria

The system can be explained on paper before implementation starts.

Phase 1 — Matching Engine Core

Weeks 2–3

Deliverables

Helipad data model

Aircraft data model

Availability model

PostGIS spatial queries

Nearest-helipad API

Availability state machine

Redis hold/lock mechanism

Now search API

Reserve search API

Swagger documentation

Initial concurrency tests

Demo

Enter a location → receive nearby helipads → see available aircraft → select a slot → temporarily hold it.

Phase 2 — Backend Foundation

Week 4

JWT authentication

Google OAuth

Role-based authorization

Operator CRUD

Aircraft CRUD

Admin CRUD / verification flow

Booking confirmation

Validation and error handling

Demo

Different users can log in and access only the operations permitted for their role.

Phase 3 — Web Frontend Core

Weeks 5–6

Authentication UI

Search UI

Map view

Nearby helipad results

Now booking flow

Reserve booking flow

Booking confirmation UI

Loading/error/empty states

Demo

A passenger can go from search → map → aircraft selection → booking confirmation.

Phase 4 — Mobile App

Weeks 7–8

React Native / Expo setup

Shared types

Authentication screens

Search

Map

Booking flow

Booking status

Basic profile

Demo

The same booking workflow works from mobile using shared domain types.

Phase 5 — Realtime

Weeks 9–10

Socket.IO integration

Booking status events

Flight lifecycle

Simulated telemetry

Passenger live status screen

Email notifications

Demo

Change the flight state on the backend and see the passenger UI update without refreshing.

Phase 6 — AI Integration

Weeks 11–12

FastAPI AI service

Trip assistant

Application-data integration

Dynamic pricing service

Weather API integration

Weather-risk scoring

AI service tests

Demo

Ask the trip assistant about a route and receive a response based on current PadHop data and weather signals.

Phase 7 — Payments & Dashboards

Week 13

Razorpay checkout

Payment verification

Payment failure handling

Operator dashboard

Fleet management

Booking management

Availability calendar

Admin dashboard

Verification and analytics

Demo

Complete an end-to-end booking with payment and show the resulting operator/admin records.

Phase 8 — Testing & Hardening

Weeks 14–15

Unit tests

API integration tests

React component tests

Playwright E2E tests

Double-booking concurrency tests

Validation tests

Payment failure tests

Error-state testing

Bug bash

Performance review

Exit criteria

The critical booking path is tested and repeatable.

Phase 9 — CI/CD & Deployment

Weeks 15–16

GitHub Actions

Lint pipeline

Test pipeline

Build pipeline

Deployment pipeline

Staging environment

Production environment

Environment variables/secrets

Sentry

Health checks

Demo

A pull request runs validation automatically and the approved application can be deployed consistently.

Phase 10 — Documentation & Packaging

Week 16

Production README

Architecture documentation

ERD

API documentation

ADRs

Matching-engine case study

H3 optimization comparison

Testing strategy

Demo video

Portfolio case study

14. Sprint Operating System

PadHop will be developed as a real software project rather than a single giant coding session.

GitHub Project workflow

BACKLOG
↓
TO DO
↓
IN PROGRESS
↓
IN REVIEW
↓
DONE

Issue workflow

Issue
↓
Feature branch
↓
Implementation
↓
Tests
↓
Pull Request
↓
Review
↓
Merge

Branch naming

feat/nearest-helipad-search
feat/booking-hold
feat/passenger-map
fix/booking-expiry
fix/pricing-rounding
chore/ci-pipeline
docs/matching-engine-adr

Commit convention

feat: add nearest helipad search
fix: prevent expired booking holds
test: add concurrent booking test
docs: document matching engine
chore: configure github actions

15. Definition of Done

A feature is not Done merely because the code works locally.

A feature is Done when:

Implementation is complete

Validation/error handling exists

Relevant tests pass

API documentation is updated where applicable

UI states are handled where applicable

Code is committed using the project convention

Pull request is reviewed

Branch is merged

Documentation is updated

Feature is demoable

16. Documentation System

The repository should continuously produce engineering evidence.

docs/
├── architecture/
│ ├── system-overview.md
│ ├── matching-engine.md
│ ├── realtime.md
│ └── diagrams/
│
├── decisions/
│ ├── ADR-001-monorepo.md
│ ├── ADR-002-postgres-postgis.md
│ ├── ADR-003-nestjs.md
│ ├── ADR-004-redis-booking-holds.md
│ └── ADR-005-h3-optimization.md
│
├── api/
│ └── README.md
│
├── testing/
│ └── strategy.md
│
└── case-study/
└── padhop-case-study.md

ADR format

Each Architecture Decision Record should answer:

What problem were we solving?

What options did we consider?

What did we choose?

Why did we choose it?

What are the trade-offs?

What would make us reconsider the decision?

17. Evidence of Real Engineering

The project should tell a story through its Git history.

Instead of:

Initial commit
Final project
Final final project

The repository should evolve visibly:

chore: initialize turborepo
feat: add helipad domain model
feat: implement postgis nearest search
feat: add aircraft availability state machine
feat: add redis booking holds
test: verify concurrent booking protection
feat: add passenger search API
feat: add map search interface
feat: add reserve booking flow
feat: add socket flight updates
feat: add ai trip assistant
feat: integrate razorpay
test: add booking e2e suite
chore: add github actions
docs: add matching engine architecture

This makes the repository look like an actively engineered product rather than a project assembled in one sitting.

18. Weekly Build Log

Maintain this section during development.

Week 1

Sprint goal: Discovery and architecture

Built

[ ]

Decisions

[ ]

Problems encountered

[ ]

What I learned

[ ]

Demo

[ ]

Next sprint

[ ]

Week 2

Sprint goal: Matching engine foundation

Built

[ ]

Decisions

[ ]

Problems encountered

[ ]

What I learned

[ ]

Demo

[ ]

Next sprint

[ ]

Continue this format for every sprint.

The build log is important because it records the engineering process, not just the final result.

19. Performance & Optimization Plan

Do not optimize before there is a measurable problem.

Baseline

First implement:

PostGIS spatial search

Measure:

Query latency

Number of candidate records

Database load

Response time under realistic data

Optimization

Only then evaluate:

H3 indexing

Compare:

Metric

PostGIS baseline

H3 version

Search latency

TBD

TBD

Candidate count

TBD

TBD

Throughput

TBD

TBD

Complexity

TBD

TBD

The final case study should explain whether H3 actually improved the measured workload.

20. Final Portfolio Story

PadHop should eventually be presented as:

A production-style helicopter charter marketplace built around geospatial matching, concurrent booking protection, real-time flight updates, payments and practical AI services.

The strongest interview topics will be:

Why helicopters require helipad-based matching

Why PostGIS was selected

How nearest-helipad search works

Why the booking state machine exists

How Redis prevents double booking

How the system handles concurrent requests

Why realtime events use Socket.IO

Why AI was separated into a FastAPI service

How dynamic pricing uses marketplace signals

Why H3 was evaluated after the baseline

How payment confirmation is handled

How the system is tested

How CI/CD works

What would change at production scale

21. Build Philosophy

Build in this order

Understand
↓
Design
↓
Build the core
↓
Test the core
↓
Expose APIs
↓
Build UI
↓
Add realtime
↓
Add AI
↓
Add payments
↓
Harden
↓
Deploy
↓
Document

Do not build everything at once.

The matching engine is the foundation.

The UI should consume real APIs.

The AI should consume real application signals.

The dashboards should reflect real domain data.

The tests should protect real business rules.

The documentation should explain real decisions.

That is what turns PadHop from a portfolio demo into an engineering project.
