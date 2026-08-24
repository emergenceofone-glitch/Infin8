export interface Character {
  name: string;
  description: string;
  relationship: string;
  status: string;
}

export interface Companion {
  name: string;
  archetype: string;
  background: string;
  abilities: string[];
  loyalty: number; // 0 to 100
  relationshipStatus: string; // e.g. "Distrustful", "Neutral", "Friendly", "Loyal", "Devoted", "Hostile"
  status: string; // e.g. "Active", "Injured", "Fallen", "Deserted"
}

export interface CombatEntry {
  outcome: string; // e.g., "Victory", "Defeat", "Narrow Escape"
  damageDealt: string; // e.g., "Player dealt 20 damage"
  tacticsUsed: string[]; // e.g., ["Shield Bash", "Healing Potion"]
  timeStamp: string;
}

export interface GameState {
  storyText: string;
  choices: string[];
  inventory: string[];
  quest: string;
  imagePrompt: string;
  difficultyLevel: number;
  lore: string[];
  characters: Character[];
  companions: Companion[];
  combatHistory: CombatEntry[];
}

export const generateStoryStep = async (
  history: { role: string; parts: { text: string }[] }[],
  userChoice: string,
  currentState?: GameState
): Promise<{ state: GameState; newHistory: { role: string; parts: { text: string }[] }[] }> => {
  const response = await fetch("/api/story/step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, userChoice, currentState }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to generate story step" }));
    throw new Error(err.error || "Failed to generate story step");
  }

  return response.json();
};

export const generateImage = async (prompt: string, size: "1K" | "2K" | "4K"): Promise<string> => {
  const response = await fetch("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to generate image" }));
    throw new Error(err.error || "Failed to generate image");
  }

  const data = await response.json();
  return data.imageUrl;
};

export const generateChatResponse = async (
  chatHistory: { role: string; parts: { text: string }[] }[],
  message: string,
  model: 'gemini-2.0-flash' | 'gemini-flash-lite-latest' | 'gemini-3.7-flash' | 'gemini-3.1-flash-lite',
  gameState: GameState | null
) => {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatHistory, message, model, gameState }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to generate chat response" }));
    throw new Error(err.error || "Failed to generate chat response");
  }

  return response.json();
};
