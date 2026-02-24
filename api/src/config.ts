import dotenv from "dotenv";

dotenv.config();

export const config = {
  apiPort: Number(process.env.API_PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGIN ?? "*").split(",").map((v) => v.trim()),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  adminApiKey: process.env.ADMIN_API_KEY ?? "dev-admin-key",
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? "Asia/Seoul"
};
