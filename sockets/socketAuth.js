const jwt = require("jsonwebtoken");

module.exports = (socket, next) => {
  try {
    console.log("🔍 HANDSHAKE AUTH:", socket.handshake.auth);
    console.log("🔍 HANDSHAKE HEADERS:", socket.handshake.headers);

    let token = socket.handshake.auth?.token;

    // Fallback ONLY if auth.token not present
    if (!token && socket.handshake.headers?.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;
    }

    if (!token) {
      console.error("❌ SOCKET AUTH: TOKEN NOT FOUND");
      return next(new Error("Unauthorized"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;

    console.log("✅ SOCKET AUTH SUCCESS:", decoded.userId || decoded.id);
    next();
  } catch (err) {
    console.error("❌ SOCKET AUTH ERROR:", err.message);
    return next(new Error("Unauthorized"));
  }
};
