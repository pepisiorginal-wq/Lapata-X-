
const express = require("express");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Ana sayfa
app.get("/", (req, res) => {
  res.json({
    success: true,
    project: "Lapata Coin",
    version: "1.0.0",
    message: "Lapata Coin API is running!"
  });
});

// Sunucu sağlık kontrolü
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "Lapata Coin API"
  });
});

// Sunucuyu başlat
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lapata Coin API running on port ${PORT}`);
});
