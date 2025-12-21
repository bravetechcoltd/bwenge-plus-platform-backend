import { Server } from "socket.io"
import http from "http"

export const initSocket = (server: http.Server) => {
  const io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:3003",
      ],
      credentials: true,
    },
  })

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id)

    socket.on("join", ({ userId, spaceId }) => {
      if (userId) socket.join(`user-${userId}`)
      if (spaceId) socket.join(`space-${spaceId}`)
    })

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id)
    })
  })

  return io
}
