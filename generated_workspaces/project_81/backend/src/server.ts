import "dotenv/config";

import cors from "cors";
import express from "express";

const app = express();

const PORT = process.env.PORT || 5000;

app.use(cors());

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
  });
});

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});