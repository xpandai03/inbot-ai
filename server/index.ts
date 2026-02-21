import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

console.log("[server] Starting InBot AI server...");
console.log(`[server] NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`[server] PORT: ${process.env.PORT || "3000 (default)"}`);
console.log(`[build] commit: ${process.env.RAILWAY_GIT_COMMIT_SHA || "unknown"}`);

// Validate required env vars early
if (!process.env.RECORDING_SECRET) {
  console.error("[server] FATAL: RECORDING_SECRET is not set. Generate one with: openssl rand -hex 32");
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// LOG EVERY SINGLE REQUEST TO PROVE SERVER IS RECEIVING TRAFFIC
app.use((req, res, next) => {
  console.log(`🔥 INCOMING REQUEST: ${req.method} ${req.path} ${req.originalUrl}`);
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    await registerRoutes(httpServer, app);

    // Log all registered routes for debugging
    console.log("[server] === REGISTERED ROUTES ===");
    const routes: string[] = [];
    app._router.stack.forEach((middleware: any) => {
      if (middleware.route) {
        // Direct route
        const methods = Object.keys(middleware.route.methods).join(",").toUpperCase();
        routes.push(`${methods} ${middleware.route.path}`);
      } else if (middleware.name === "router") {
        // Router middleware
        middleware.handle.stack.forEach((handler: any) => {
          if (handler.route) {
            const methods = Object.keys(handler.route.methods).join(",").toUpperCase();
            routes.push(`${methods} ${handler.route.path}`);
          }
        });
      }
    });
    routes.forEach(r => console.log(`[server] Route: ${r}`));
    console.log("[server] === END ROUTES ===");

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      throw err;
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Default to 3000 if not specified (5000 is often used by macOS AirPlay).
    // this serves both the API and the client.
    const port = parseInt(process.env.PORT || "3000", 10);
    httpServer.listen(
      port,
      "0.0.0.0",
      () => {
        log(`serving on port ${port}`);
      },
    );
  } catch (error) {
    console.error("[server] FATAL: Failed to start server:", error);
    process.exit(1);
  }
})();
