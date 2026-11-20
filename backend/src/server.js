import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.routes.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientOrigin = process.env.CLIENT_URL || true;

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        mediaSrc: ["'self'", "blob:"],
        imgSrc: ["'self'", "data:"],
      },
    },
  }),
);
app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ app: "SecureChat", status: "Running" });
});

app.use("/api/auth", authRoutes);

const io = new Server(server, {
  cors: {
    origin: clientOrigin,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 12_000_000,
});

const validRoom = (room) =>
  typeof room === "string" && /^[A-Za-z0-9_-]{12,80}$/.test(room);

const emitRoomCount = (room) => {
  io.to(room).emit("room-count", io.sockets.adapter.rooms.get(room)?.size || 0);
};

io.on("connection", (socket) => {
  socket.data.packetWindowStarted = Date.now();
  socket.data.packetCount = 0;

  socket.on("join-room", async (room, acknowledge) => {
    if (!validRoom(room)) {
      if (typeof acknowledge === "function") acknowledge({ error: "Invalid room." });
      return;
    }

    if (socket.data.room) {
      await socket.leave(socket.data.room);
      emitRoomCount(socket.data.room);
    }

    socket.data.room = room;
    await socket.join(room);
    emitRoomCount(room);
    if (typeof acknowledge === "function") acknowledge({ ok: true });
  });

  socket.on("encrypted-packet", (packet) => {
    const now = Date.now();
    if (now - socket.data.packetWindowStarted >= 10_000) {
      socket.data.packetWindowStarted = now;
      socket.data.packetCount = 0;
    }
    socket.data.packetCount += 1;

    const room = socket.data.room;
    if (
      socket.data.packetCount > 100 ||
      !room ||
      !packet ||
      typeof packet.iv !== "string" ||
      typeof packet.data !== "string" ||
      packet.iv.length > 32 ||
      packet.data.length > 10_000_000
    ) {
      return;
    }

    socket.to(room).emit("encrypted-packet", {
      senderId: socket.id,
      iv: packet.iv,
      data: packet.data,
    });
  });

  socket.on("disconnect", () => {
    if (socket.data.room) emitRoomCount(socket.data.room);
  });
});

const startServer = async () => {
  try {
    await connectDB();
  } catch (error) {
    console.error(`MongoDB unavailable; authentication endpoints are offline: ${error.message}`);
  }

  const port = Number(process.env.PORT) || 5000;
  server.listen(port, "0.0.0.0", () => {
    console.log(`SecureChat running at http://localhost:${port}`);
  });
};

startServer();
