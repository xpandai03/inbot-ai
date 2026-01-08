# VAPI Secure Intake Dashboard - Design Guidelines

## Design Approach

**Reference-Based: Apple HIG + Linear Aesthetic**

The application prioritizes trust, clarity, and institutional credibility. This is a data-heavy enterprise dashboard that must feel authoritative and calm—designed for municipal/healthcare organizations.

**Core Principles:**
- Minimalist, content-focused interface with generous breathing room
- Liquid-glass aesthetic with soft shadows and subtle depth
- Zero visual clutter—every element must justify its presence
- Tables and data displays are the primary focus
- No "SaaS spammy" elements or heavy visual treatments

---

## Typography

**System:**
- Primary: Inter or SF Pro Display (via Google Fonts)
- Fallback: System UI stack

**Hierarchy:**
- Page titles: text-2xl to text-3xl, font-semibold
- Section headers: text-lg, font-medium
- Table headers: text-sm, font-medium, uppercase tracking-wide
- Body text: text-sm to text-base, font-normal
- Labels/metadata: text-xs, font-medium

**Critical:** Maintain generous line-height (leading-relaxed) for readability in data-dense contexts.

---

## Layout System

**Spacing Primitives:**
Use Tailwind units: **2, 4, 6, 8, 12, 16**

- Micro spacing: p-2, gap-2 (tight elements)
- Standard spacing: p-4, gap-4, m-6 (component padding)
- Section spacing: py-8, py-12 (vertical rhythm)
- Page margins: p-6 to p-12 (container padding)

**Grid System:**
- Dashboard container: max-w-7xl mx-auto
- Two-column layouts: grid-cols-1 lg:grid-cols-2
- Cards/stats: grid-cols-1 md:grid-cols-2 lg:grid-cols-4

---

## Component Library

### Navigation & Header
- Top navbar with role indicator (pill badge showing "Client" or "Super Admin")
- Minimal navigation—logout button, possibly settings icon
- Sticky positioning for persistent context
- Soft bottom border for subtle separation

### Data Tables
**Priority Component** - This is the centerpiece:
- Full-width tables with ample cell padding (px-6 py-4)
- Alternating row backgrounds (subtle stripe on hover)
- Rounded table container with soft shadow
- Column headers with sorting indicators
- Generous column spacing—no cramped data
- Empty states with helpful messaging
- Sticky headers for long tables

### Cards & Stat Blocks
- Rounded corners (rounded-lg to rounded-xl)
- Soft shadows (shadow-sm)
- White/very light backgrounds
- Minimal borders or hairline dividers
- Stats displayed prominently with supporting labels beneath

### Buttons
- Primary: Rounded, medium padding (px-6 py-2.5)
- Ghost/Secondary: Minimal background, slight border
- Icon buttons: Square/circular, subtle hover states
- No aggressive gradients or heavy shadows

### Modals
- Centered overlay with backdrop blur
- Generous padding (p-8 to p-12)
- Clear header with close button
- Actions aligned right (Cancel, Confirm pattern)

### Filters & Controls
- Horizontal filter bar with dropdown selectors
- Pills for active filters (removable with × icon)
- Search inputs with left icon, no heavy borders
- Date range pickers with calendar icon

### Role Indicators
- Prominent but tasteful badge in header
- Different visual weight for Client vs Super Admin
- Clear hierarchy without being loud

---

## Visual Treatment

**Shadows & Depth:**
- Use sparingly: shadow-sm for cards, shadow-md for modals
- Avoid heavy drop shadows entirely

**Borders:**
- Hairline borders (border with very light opacity)
- Rounded corners universally (rounded-lg default)
- No sharp edges

**Spacing Philosophy:**
- Tables breathe—generous cell padding
- Sections separated by vertical space, not dividers
- White space is a design element

**States:**
- Hover: Subtle background change, no dramatic shifts
- Active/Selected: Minimal accent (thin border or light fill)
- Loading: Skeleton screens with gentle pulse animation

---

## Dashboard-Specific Requirements

### Client View
- Welcome section with user name
- Primary table with 7-8 visible columns
- Top actions bar: Download CSV, Send Broadcast SMS
- Department filter dropdown
- Clean pagination or infinite scroll

### Super Admin View
- All client view elements PLUS:
- Top metrics row (4 stat cards: Total Records, Minutes Today, Total Cost, Revenue)
- Client selector dropdown (fake but functional)
- Cost markup percentage input (read-only display or simple slider)
- Expanded table showing cost column
- Clear visual distinction from client view (different accent or header treatment)

---

## Trust & Authority Elements

**Must convey:**
- Data permanence (this is the source of truth)
- Security (professional, not playful)
- Institutional credibility (gov/healthcare aesthetic)

**Achieve through:**
- Restrained visual language
- Consistent typography hierarchy
- Generous spacing creating gravitas
- No decorative elements or illustrations
- Professional iconography (Heroicons recommended)

---

## Critical Constraints

- No exposed debug information
- No toy-like visuals or playful elements
- No bright accent colors (use neutral palette)
- No heavy animations or transitions
- Loading states must be professional (no spinners that feel "cheap")
- Empty states are helpful, not cute

---

## Images

**No hero images for this application.** This is a dashboard/data tool, not a marketing site. Any imagery should be:
- User avatars (if needed): Circular, initials fallback
- Icons: System icons only (Heroicons), no custom illustrations
- Charts/graphs (if implemented): Minimal, monochromatic with subtle accents