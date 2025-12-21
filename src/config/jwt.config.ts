import dotenv from 'dotenv';
import { Secret } from 'jsonwebtoken';
dotenv.config();

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not defined in environment variables');
}

export const JWT_SECRET: Secret = process.env.JWT_SECRET;
export const JWT_EXPIRES_IN = '1h';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      JWT_SECRET: string;
      [key: string]: string | undefined;
    }
  }
}
