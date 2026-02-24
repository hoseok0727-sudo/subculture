import express from "express";

export function asyncRoute(handler: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res).catch(next);
  };
}

export function csvToIntArray(input?: string) {
  if (!input) return [];
  return input
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v > 0);
}

export function csvToEnumArray<T extends string>(input: string | undefined, allowed: readonly T[]) {
  if (!input) return [];
  return input
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter((v): v is T => allowed.includes(v as T));
}
