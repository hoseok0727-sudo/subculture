import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { extractBearerToken, verifyAccessToken } from "./auth.js";

export function withOptionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req.header("authorization"));
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      req.authUser = payload;
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header("x-admin-key");
  if (apiKey && apiKey === config.adminApiKey) {
    return next();
  }

  if (!req.authUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.authUser.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin only" });
  }

  return next();
}
