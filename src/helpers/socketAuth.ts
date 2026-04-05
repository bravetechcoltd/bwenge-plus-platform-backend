import type { Socket } from "socket.io"
import jwt from "jsonwebtoken"

interface DecodedToken {
  id: string
  userId: string 
  email: string
  username: string
  account_type: string
}

export const socketAuthMiddleware = async (socket: Socket, next: (err?: Error) => void) => {
  try {
    const token = socket.handshake.auth.token

    if (!token) {
      return next(new Error("Authentication token required"))
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key") as DecodedToken


    // FIXED: Attach user data with BOTH id and userId for compatibility
    socket.data.user = {
      id: decoded.id || decoded.userId, // Support both field names
      userId: decoded.id || decoded.userId, // Ensure userId is always set
      email: decoded.email,
      username: decoded.username,
      account_type: decoded.account_type,
    }


    next()
  } catch (error) {
    next(new Error("Authentication failed"))
  }
}