// Simple in-memory data store for habits and entries
// In a real project this would be replaced with a DB layer

export const habits = [];

// Each habit has the shape:
// {
//   id: string (uuid),
//   name: string,
//   description?: string,
//   createdAt: Date,
//   entries: [{ date: string (ISO), completed: boolean }]
// }
