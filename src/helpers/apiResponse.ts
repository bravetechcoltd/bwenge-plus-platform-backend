import { Response } from 'express';

export class ApiResponse {
  static serverError(res: Response<any, Record<string, any>>, arg1: string) {
    throw new Error('Method not implemented.');
  }
  static success(res: Response, message: string, data?: any, statusCode: number = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data
    });
  }

  static created(res: Response, message: string, data?: any) {
    return res.status(201).json({
      success: true,
      message,
      data
    });
  }

  static error(res: Response, message: string, error?: any, statusCode: number = 500) {
    return res.status(statusCode).json({
      success: false,
      message,
      error: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }

  static badRequest(res: Response, message: string, errors?: any) {
    return res.status(400).json({
      success: false,
      message,
      errors
    });
  }

  static unauthorized(res: Response, message: string = 'Unauthorized') {
    return res.status(401).json({
      success: false,
      message
    });
  }

  static forbidden(res: Response, message: string = 'Forbidden') {
    return res.status(403).json({
      success: false,
      message
    });
  }

  static notFound(res: Response, message: string = 'Not found') {
    return res.status(404).json({
      success: false,
      message
    });
  }

  static conflict(res: Response, message: string) {
    return res.status(409).json({
      success: false,
      message
    });
  }
}
