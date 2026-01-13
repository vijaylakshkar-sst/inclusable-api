require("dotenv").config();
const http = require("http");
const app = require("./app");
const { initSocket } = require("./sockets");

const PORT = process.env.PORT || 3001;

// ONE shared server
const server = http.createServer(app);

// attach socket
initSocket(server);

// start server
server.listen(PORT, () => {
  console.log(`🚀 API + WebSocket running on port ${PORT}`);
});
