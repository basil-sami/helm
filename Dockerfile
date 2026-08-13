# ── Stage 1: build the frontend ──────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: backend + built frontend ────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev
COPY backend/ ./backend/
COPY supabase/ ./supabase/
COPY --from=frontend /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Apply schema + seed-if-empty against DATABASE_URL, then serve API + SPA.
CMD ["node", "backend/scripts/docker-entry.js"]
