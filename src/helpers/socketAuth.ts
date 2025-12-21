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
      console.error("❌ [socketAuth] No token provided")
      return next(new Error("Authentication token required"))
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key") as DecodedToken

    console.log("✅ [socketAuth] Token decoded:", {
      id: decoded.id,
      userId: decoded.userId,
      email: decoded.email,
      account_type: decoded.account_type
    })

    // FIXED: Attach user data with BOTH id and userId for compatibility
    socket.data.user = {
      id: decoded.id || decoded.userId, // Support both field names
      userId: decoded.id || decoded.userId, // Ensure userId is always set
      email: decoded.email,
      username: decoded.username,
      account_type: decoded.account_type,
    }

    console.log("✅ [socketAuth] User authenticated:", {
      id: socket.data.user.id,
      userId: socket.data.user.userId,
      email: socket.data.user.email
    })

    next()
  } catch (error) {
    console.error("❌ [socketAuth] Authentication failed:", error)
    next(new Error("Authentication failed"))
  }
}