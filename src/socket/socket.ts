import dotenv from 'dotenv';
dotenv.config();

import { Server, Socket } from "socket.io"
import http from "http"
import jwt from "jsonwebtoken"
import dbConnection from "../database/db"
import { SpaceMember } from "../database/models/SpaceMemberModel"
import { User, BwengeRole } from "../database/models/User"
import { InstitutionMember } from "../database/models/InstitutionMember"
import { setSocketIO } from "./socketEmitter"

interface SocketWithUser extends Socket {
  data: {
    userId?: string
    bwengeRole?: string
    institutionId?: string
  }
}

// ── Enhancement #8: Online presence tracking (exported for REST endpoint) ────
export const onlineUsers = new Set<string>()

export const initSocket = (server: http.Server) => {
  const io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3003",
        "https://plus.bwenge.com",
        "https://www.plus.bwenge.com",
        "https://bwenge.com",
        "https://www.bwenge.com",
        "https://ongera.rw",
        "https://www.ongera.rw",
      ],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    path: "/socket.io/",
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  })

  io.use(async (socket: SocketWithUser, next) => {
    try {
      let token = socket.handshake.auth.token

      if (!token && socket.handshake.headers.authorization) {
        const authHeader = socket.handshake.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7);
        }
      }

      if (!token) {
        return next(new Error("Authentication required"))
      }

      const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key"

      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET) as any
      } catch (jwtError: any) {
        return next(new Error("Invalid token"))
      }

      const userId = decoded.userId || decoded.id || decoded.user_id || decoded.sub

      if (!userId) {
        return next(new Error("Invalid token format - missing user ID"))
      }

      socket.data.userId = userId
      next()
    } catch (error) {
      next(new Error("Invalid token"))
    }
  })

  // Store the io instance globally for controllers/services
  setSocketIO(io)

  io.on("connection", async (socket: SocketWithUser) => {

    if (socket.data.userId) {
      socket.join(`user-${socket.data.userId}`)
      socket.emit("user-room-joined", { userId: socket.data.userId })

      // ── Enhancement #8: Broadcast user is online ──────────────────────────
      onlineUsers.add(socket.data.userId)
      io.emit("user-online", { userId: socket.data.userId })

      // ── Auto-join role-based rooms ────────────────────────────────────────
      try {
        const userRepo = dbConnection.getRepository(User)
        const user = await userRepo.findOne({
          where: { id: socket.data.userId },
          select: ["id", "bwenge_role", "primary_institution_id"],
        })

        if (user) {
          socket.data.bwengeRole = user.bwenge_role

          // System admins join the admin room
          if (user.bwenge_role === BwengeRole.SYSTEM_ADMIN) {
            socket.join("room-system-admins")
          }

          // Institution admins join their institution room
          if (user.bwenge_role === BwengeRole.INSTITUTION_ADMIN && user.primary_institution_id) {
            socket.data.institutionId = user.primary_institution_id
            socket.join(`institution-${user.primary_institution_id}`)
          }

          // Also join institution rooms for all institution memberships
          const memberRepo = dbConnection.getRepository(InstitutionMember)
          const memberships = await memberRepo.find({
            where: { user_id: socket.data.userId, is_active: true },
            select: ["institution_id"],
          })
          for (const m of memberships) {
            if (m.institution_id) {
              socket.join(`institution-${m.institution_id}`)
            }
          }
        }
      } catch (err) {
        // Non-critical: role-based room join failed, user room still works
      }
    }

    // ── Join room handler ─────────────────────────────────────────────────────
    socket.on("join", async ({ userId, spaceId }) => {
      const authedUserId = socket.data.userId

      if (!authedUserId) {
        socket.emit("error", { message: "Not authenticated" })
        return
      }

      if (userId) {
        if (userId !== authedUserId) {
          socket.emit("error", { message: "Not authorized to join this user room" })
          return
        }
        socket.join(`user-${authedUserId}`)
        socket.emit("user-room-joined", { userId: authedUserId })
      }

      if (spaceId && authedUserId) {
        try {
          const memberRepo = dbConnection.getRepository(SpaceMember)
          const membership = await memberRepo.findOne({
            where: { spaceId, userId: authedUserId },
          })

          if (membership) {
            socket.join(`space-${spaceId}`)
            socket.emit("space-joined", { spaceId })
          } else {
            socket.emit("error", { message: "Not a member of this space" })
          }
        } catch (error) {
          socket.emit("error", { message: "Failed to verify space membership" })
        }
      }
    })

    // ── Enhancement #2: Typing indicators ────────────────────────────────────
    socket.on("typing-start", ({ conversationId, receiverId }: { conversationId: string; receiverId: string }) => {
      const senderId = socket.data.userId
      if (!senderId || !receiverId) return
      io.to(`user-${receiverId}`).emit("typing-start", { conversationId, senderId })
    })

    socket.on("typing-stop", ({ conversationId, receiverId }: { conversationId: string; receiverId: string }) => {
      const senderId = socket.data.userId
      if (!senderId || !receiverId) return
      io.to(`user-${receiverId}`).emit("typing-stop", { conversationId, senderId })
    })

    // ── Space typing indicators ──────────────────────────────────────────────
    socket.on("space-typing-start", ({ spaceId }: { spaceId: string }) => {
      const senderId = socket.data.userId
      if (!senderId || !spaceId) return
      socket.to(`space-${spaceId}`).emit("space-typing-start", { spaceId, senderId })
    })

    socket.on("space-typing-stop", ({ spaceId }: { spaceId: string }) => {
      const senderId = socket.data.userId
      if (!senderId || !spaceId) return
      socket.to(`space-${spaceId}`).emit("space-typing-stop", { spaceId, senderId })
    })

    // ── Join course room ──────────────────────────────────────────────────────
    socket.on("join-course", ({ courseId }: { courseId: string }) => {
      if (socket.data.userId && courseId) {
        socket.join(`course-${courseId}`)
      }
    })

    socket.on("leave-course", ({ courseId }: { courseId: string }) => {
      if (socket.data.userId && courseId) {
        socket.leave(`course-${courseId}`)
      }
    })

    // ── Enhancement #8: Get current online users ──────────────────────────────
    socket.on("get-online-users", () => {
      socket.emit("online-users", { users: Array.from(onlineUsers) })
    })

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on("disconnect", (reason) => {

      if (socket.data.userId) {
        // Only mark offline if no other socket for same user is connected
        const userRoom = io.sockets.adapter.rooms.get(`user-${socket.data.userId}`)
        if (!userRoom || userRoom.size === 0) {
          onlineUsers.delete(socket.data.userId)
          io.emit("user-offline", { userId: socket.data.userId })
        }
      }
    })

    socket.on("error", (error) => {
    })
  })

  return io
}
