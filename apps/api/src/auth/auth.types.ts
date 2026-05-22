import { Request } from "express";

export type AuthCookie = {
  userId: number;
};

export type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    username: string;
  };
};
