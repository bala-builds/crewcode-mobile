// In-memory settings store for the E2E fixture.
let settings = { displayName: "Balu", reminders: true };

export function getSettings() {
  return settings;
}

export function setSettings(patch) {
  settings = { ...settings, ...patch };
  return settings;
}
