// server.js

const app = require('./app');

const PORT = process.env.PORT || 4000;
// const HOST = '10.8.21.182';
const HOST = 'localhost';


app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});
