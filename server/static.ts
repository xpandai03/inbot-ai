import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  console.log(`[static] __dirname: ${__dirname}`);
  console.log(`[static] Looking for build at: ${distPath}`);
  console.log(`[static] Directory exists: ${fs.existsSync(distPath)}`);

  if (!fs.existsSync(distPath)) {
    // List what's actually in __dirname to help debug
    try {
      const contents = fs.readdirSync(__dirname);
      console.log(`[static] Contents of ${__dirname}: ${contents.join(", ")}`);
    } catch (e) {
      console.log(`[static] Could not read ${__dirname}`);
    }
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  // IMPORTANT: Exclude API and webhook routes from catch-all
  app.use("*", (req, res, next) => {
    // Don't intercept API routes, webhooks, or debug endpoints
    if (req.originalUrl.startsWith("/api") ||
        req.originalUrl.startsWith("/webhook") ||
        req.originalUrl.startsWith("/debug")) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
