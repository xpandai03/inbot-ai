# VAPI Secure Intake Dashboard

## Overview

A high-fidelity demo web application showcasing a secure AI-powered voice and SMS intake system. Built for sales demonstrations to municipal/healthcare organizations, it visualizes how AI calls and texts become structured records while demonstrating role-based access control between Super Admin and Client User views.

The application is designed to convey trust, clarity, and institutional credibility through a minimalist, data-focused interface inspired by Apple HIG and Linear aesthetics.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui component library (New York style)
- **Build Tool**: Vite with HMR support

The frontend follows a client-side SPA pattern with pages in `client/src/pages/` and reusable components in `client/src/components/`. Role-based UI switching is handled via React Context (`RoleProvider`).

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: REST endpoints under `/api/*`
- **Webhook**: `/webhook/vapi` endpoint for intake record creation

The server uses a simple in-memory storage layer (`server/storage.ts`) with seed data for demo purposes. This is intentionally lightweight since the application is a demo build, not production.

### Data Layer
- **Schema Definition**: Zod schemas in `shared/schema.ts` for runtime validation
- **ORM**: Drizzle ORM configured for PostgreSQL (available for future database integration)
- **Current Storage**: In-memory with pre-seeded demo records

### Role-Based Access
Two mock user roles are supported without full authentication:
- **Client User**: Views department-specific intake records
- **Super Admin**: Full access including cost data, client filtering, and markup controls

### Design System
- Minimalist, liquid-glass aesthetic with soft shadows
- Primary font: Inter/DM Sans via Google Fonts
- Color system using CSS custom properties with HSL values
- Components follow Apple HIG principles for enterprise credibility

## External Dependencies

### UI Component Libraries
- **shadcn/ui**: Full component suite (dialogs, tables, forms, etc.)
- **Radix UI**: Headless primitives for accessibility
- **Lucide React**: Icon library

### Data & Forms
- **TanStack React Query**: Server state management and caching
- **React Hook Form + Zod**: Form validation
- **date-fns**: Date formatting utilities

### Database (Configured, Optional)
- **PostgreSQL**: Via `DATABASE_URL` environment variable
- **Drizzle ORM**: Schema management and queries
- **connect-pg-simple**: Session storage (if sessions needed)

### Build & Development
- **Vite**: Frontend bundling with React plugin
- **esbuild**: Server bundling for production
- **TSX**: TypeScript execution for development