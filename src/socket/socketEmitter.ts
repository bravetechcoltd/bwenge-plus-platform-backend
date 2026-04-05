// @ts-nocheck
/**
 * Socket Emitter Utility
 * Provides a centralized way for controllers/services to emit socket events
 * without directly importing the io instance from index.ts
 */

import { Server } from "socket.io";

let ioInstance: Server | null = null;

/**
 * Set the Socket.IO server instance (called once from index.ts after initSocket)
 */
export function setSocketIO(io: Server) {
  ioInstance = io;
}

/**
 * Get the Socket.IO server instance
 */
export function getIO(): Server | null {
  return ioInstance;
}

// ─── Emit to a specific user room ─────────────────────────────────────────────
export function emitToUser(userId: string, event: string, data: any) {
  if (ioInstance) {
    ioInstance.to(`user-${userId}`).emit(event, data);
  }
}

// ─── Emit to multiple users ───────────────────────────────────────────────────
export function emitToUsers(userIds: string[], event: string, data: any) {
  if (!ioInstance) return;
  for (const userId of userIds) {
    ioInstance.to(`user-${userId}`).emit(event, data);
  }
}

// ─── Emit to a space room ────────────────────────────────────────────────────
export function emitToSpace(spaceId: string, event: string, data: any) {
  if (ioInstance) {
    ioInstance.to(`space-${spaceId}`).emit(event, data);
  }
}

// ─── Emit to an admin room ──────────────────────────────────────────────────
export function emitToAdminRoom(event: string, data: any) {
  if (ioInstance) {
    ioInstance.to("room-system-admins").emit(event, data);
  }
}

// ─── Emit to an institution admin room ──────────────────────────────────────
export function emitToInstitutionAdmins(institutionId: string, event: string, data: any) {
  if (ioInstance) {
    ioInstance.to(`institution-${institutionId}`).emit(event, data);
  }
}

// ─── Emit to a course room (all enrolled students + instructors) ────────────
export function emitToCourse(courseId: string, event: string, data: any) {
  if (ioInstance) {
    ioInstance.to(`course-${courseId}`).emit(event, data);
  }
}

// ─── Broadcast to everyone ──────────────────────────────────────────────────
export function emitToAll(event: string, data: any) {
  if (ioInstance) {
    ioInstance.emit(event, data);
  }
}
