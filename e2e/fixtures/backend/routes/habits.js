import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { habits } from "../data/store.js";

const router = Router();

// GET /habits - list all habits
router.get("/", (req, res) => {
  res.json(habits.map(h => ({ ...h, entries: undefined })));
});

// POST /habits - create a new habit
router.post("/", (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Habit name is required" });
  }
  const newHabit = {
    id: uuidv4(),
    name,
    description: description || "",
    createdAt: new Date().toISOString(),
    entries: []
  };
  habits.push(newHabit);
  res.status(201).json(newHabit);
});

// GET /habits/:id - get a single habit (including entries)
router.get("/:id", (req, res) => {
  const habit = habits.find(h => h.id === req.params.id);
  if (!habit) return res.status(404).json({ error: "Habit not found" });
  res.json(habit);
});

// PUT /habits/:id - update habit name/description
router.put("/:id", (req, res) => {
  const habit = habits.find(h => h.id === req.params.id);
  if (!habit) return res.status(404).json({ error: "Habit not found" });
  const { name, description } = req.body;
  if (name) habit.name = name;
  if (description !== undefined) habit.description = description;
  res.json(habit);
});

// DELETE /habits/:id - remove a habit
router.delete("/:id", (req, res) => {
  const index = habits.findIndex(h => h.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Habit not found" });
  habits.splice(index, 1);
  res.status(204).send();
});

// GET /habits/:id/entries - list entries for a habit
router.get("/:id/entries", (req, res) => {
  const habit = habits.find(h => h.id === req.params.id);
  if (!habit) return res.status(404).json({ error: "Habit not found" });
  res.json(habit.entries);
});

// POST /habits/:id/entries - add an entry for today (or specific date)
router.post("/:id/entries", (req, res) => {
  const habit = habits.find(h => h.id === req.params.id);
  if (!habit) return res.status(404).json({ error: "Habit not found" });
  const { date, completed } = req.body;
  const entryDate = date ? new Date(date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
  const existing = habit.entries.find(e => e.date === entryDate);
  if (existing) {
    existing.completed = !!completed;
    return res.json(existing);
  }
  const newEntry = { date: entryDate, completed: !!completed };
  habit.entries.push(newEntry);
  res.status(201).json(newEntry);
});

export default router;
