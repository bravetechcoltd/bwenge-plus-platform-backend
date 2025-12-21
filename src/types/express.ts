// @ts-nocheck

import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    userId: number;
    organizationId: number;
    role?: string;
    userType: 'user' | 'employee';
  };
}
