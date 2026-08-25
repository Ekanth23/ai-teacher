import type { NextFunction, Request, Response } from "express";
import { getBearerToken, getUserById, InvalidTokenError, verifyAccessToken, type AuthenticatedUser } from "./tokens.js";

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const token = getBearerToken(authHeader);

  if (!token) {
    return res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Authentication required.",
      },
    });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await getUserById(payload.sub);

    if (!user || user.status !== "ACTIVE") {
      throw new InvalidTokenError();
    }

    (req as AuthenticatedRequest).user = user;
    return next();
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      return res.status(401).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    console.error("Auth middleware error:", error);
    return res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Authentication failed.",
      },
    });
  }
}
