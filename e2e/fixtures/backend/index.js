import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import habitRouter from "./routes/habits.js";
import { API_BASE } from "./config.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", project: "Habit Tracker" });
});

// Mount habit routes under the shared API base path
app.use(`${API_BASE}/habits`, habitRouter);

app.listen(PORT, () => {
  console.log(`${"Habit Tracker"} backend running on http://localhost:${PORT}`);
  console.log(`API base: ${API_BASE}`);
});
