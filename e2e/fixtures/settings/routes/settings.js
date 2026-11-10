import { Router } from "express";
import { getSettings, setSettings } from "../data/store.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(getSettings());
});

router.put("/", (req, res) => {
  const next = setSettings(req.body || {});
  res.json(next);
});

export default router;
