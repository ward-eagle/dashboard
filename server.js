// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 4000;
const __dirname = path.resolve();
const MESSAGES_FILE = path.join(__dirname, "messages.json");

// Middleware
app.use(cors());
app.use(express.json());

// -------------------- Pages API (placed BEFORE static) --------------------
app.get("/pages", (req, res) => {
  const publicDir = path.join(__dirname, "public");
  let pages = [];
  try {
    pages = fs.readdirSync(publicDir).filter((f) => f.endsWith(".html"));
  } catch (err) {
    console.error("Error reading pages:", err);
  }
  res.json(pages);
});

// -------------------- Static files --------------------
app.use(express.static(path.join(__dirname, "public")));

// -------------------- Messages --------------------
function readMessages() {
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8"));
  } catch (err) {
    console.error("Error reading messages:", err);
    return [];
  }
}

function writeMessages(messages) {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error("Error writing messages:", err);
  }
}

app.get("/api/messages", (req, res) => res.json(readMessages()));

app.post("/api/messages", (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Message text is required" });

  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const newMessage = { time, text };
  const messages = readMessages();
  messages.push(newMessage);
  writeMessages(messages);

  res.status(201).json(newMessage);
});

// -------------------- Online Tracking --------------------
const activeUsers = new Map();
app.post("/track-online", (req, res) => {
  const id =
    req.body.id || (req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
  activeUsers.set(id, Date.now());
  res.sendStatus(200);
});

app.get("/online-users", (req, res) => {
  const now = Date.now();
  const ACTIVE_WINDOW = 10000;
  for (let [id, lastSeen] of activeUsers.entries()) {
    if (now - lastSeen > ACTIVE_WINDOW) activeUsers.delete(id);
  }
  res.json({ online: activeUsers.size });
});

// -------------------- Socket.IO --------------------
let users = {};

io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);

  const role = socket.handshake.query.role || "user";
  const username = socket.handshake.query.name || (role === "admin" ? "Admin" : "Guest");

  users[socket.id] = { socketId: socket.id, username, role, currentPage: "index.html" };

  const broadcastUserList = () => {
    const admins = Object.values(users).filter((u) => u.role === "admin");
    admins.forEach((admin) => {
      io.to(admin.socketId).emit("userList", users);
      io.to(admin.socketId).emit("onlineCount", Object.keys(users).length);
    });
  };

  broadcastUserList();

  socket.on("pageUpdate", (page) => {
    if (users[socket.id]) {
      users[socket.id].currentPage = page;
      broadcastUserList();
      console.log(`📄 ${users[socket.id].username} (${socket.id}) is on ${page}`);
    }
  });

  socket.on("moveUser", ({ socketId, page }) => {
    if (users[socket.id]?.role !== "admin") {
      console.log(`⚠️ Non-admin ${socket.id} tried to move a user`);
      return;
    }
    if (users[socketId]) {
      users[socketId].currentPage = page;
      io.to(socketId).emit("navigate", page);
      broadcastUserList();
      console.log(`➡️ Admin moved ${socketId} to ${page}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    delete users[socket.id];
    broadcastUserList();
  });
});

server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
