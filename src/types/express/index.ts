// @ts-nocheck

import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        organizationId: number;
        role?: string;
        userType: 'user' | 'employee';
      };
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user: {
    userId: number;
    organizationId: number;
    role?: string;
    userType: 'user' | 'employee';
  };
}
