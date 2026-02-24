import { Router } from "express";
import { z } from "zod";
import { hashPassword, signAccessToken, verifyPassword } from "../auth.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { asyncRoute } from "./helpers.js";

export const authRouter = Router();

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(64),
  timezone: z.string().min(1).max(64).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(64)
});

authRouter.post(
  "/signup",
  asyncRoute(async (req, res) => {
    const parsed = signUpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { email, password, timezone } = parsed.data;
    const passwordHash = await hashPassword(password);

    const result = await pool.query<{
      id: string;
      email: string;
      role: "USER" | "ADMIN";
      timezone: string;
    }>(
      `INSERT INTO users (email, password_hash, timezone, role)
       VALUES ($1, $2, $3, 'USER')
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, role, timezone`,
      [email, passwordHash, timezone ?? config.defaultTimezone]
    );

    const user = result.rows[0];

    if (!user) {
      res.status(409).json({ error: "Email already exists" });
      return;
    }

    const token = signAccessToken({
      sub: Number(user.id),
      email: user.email,
      role: user.role
    });

    res.status(201).json({
      token,
      user: {
        id: Number(user.id),
        email: user.email,
        role: user.role,
        timezone: user.timezone
      }
    });
  })
);

authRouter.post(
  "/login",
  asyncRoute(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const result = await pool.query<{
      id: string;
      email: string;
      password_hash: string | null;
      role: "USER" | "ADMIN";
      timezone: string;
    }>(
      `SELECT id, email, password_hash, role, timezone
       FROM users
       WHERE email = $1`,
      [parsed.data.email]
    );

    const user = result.rows[0];

    if (!user?.password_hash) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await verifyPassword(parsed.data.password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signAccessToken({
      sub: Number(user.id),
      email: user.email,
      role: user.role
    });

    res.json({
      token,
      user: {
        id: Number(user.id),
        email: user.email,
        role: user.role,
        timezone: user.timezone
      }
    });
  })
);

authRouter.post(
  "/logout",
  asyncRoute(async (_req, res) => {
    res.json({ ok: true });
  })
);
