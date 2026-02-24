import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export type AuthRole = "USER" | "ADMIN";

export type AuthTokenPayload = {
  sub: number;
  email: string;
  role: AuthRole;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "14d" });
}

export function verifyAccessToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded !== "object" || !decoded) return null;

    const payload = decoded as Partial<AuthTokenPayload>;
    if (!payload.sub || !payload.email || !payload.role) return null;
    if (payload.role !== "USER" && payload.role !== "ADMIN") return null;

    return {
      sub: Number(payload.sub),
      email: String(payload.email),
      role: payload.role
    };
  } catch {
    return null;
  }
}

export function extractBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}
