import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

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
  loyalty: number;
  relationshipStatus: string;
  status: string;
}

export interface CombatEntry {
  outcome: string;
  damageDealt: string;
  tacticsUsed: string[];
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

const SYSTEM_INSTRUCTION = `You are an expert dungeon master running an infinite choose-your-own-adventure game.
The user will provide their choice or action.
You must advance the plot in a meaningful, creative, and unexpected way based on their choice.
Maintain a consistent dark fantasy tone.
You must track the user's inventory and current quest. Update them logically based on the story events.

Persistent Lore Database:
Maintain a list of "lore" entries. These represent key facts discovered about the world, people encountered, or significant plot events. 
When you discover new information or experience a major event, identify if it should be added to the lore.
DO NOT repeat existing lore. Only output NEW lore entries in the "newLoreEntries" field.
Future story steps and dialogue MUST remain consistent with the established lore.

Character Tracking:
Maintain a list of key characters encountered. Track their traits, the user's relationship with them, and their current status (e.g., alive, missing, hostile).
Update this list as characters change or new ones are introduced. Ensure character personalities remain consistent.

Companion & Recruit System:
The player can recruit allies as Companions. Keep track of current companions in the "companions" array.
Companions have:
1. unique backgrounds and distinct talents ("abilities").
2. "loyalty" level (0 to 100) and "relationshipStatus" (e.g. Distrustful, Neutral, Warm, Loyal, Devoted).
Influence companion loyalty based on the player's choices and moral decisions. Loyalty increases if choices match the companion's values and decreases if contradicted.
If loyalty drop to 0, they might desert or turn hostile.
Introduce opportunities for the user to encounter or recruit potential companions of these archetypes:
- "Gloomweaver" (uses shadow magic/stealth, values pragmatic choices, cunning, exploration of forbidden dark knowledge, survival)
- "Aegis Sentinel" (heavily armored protectors/knights, values chivalry, justice, shield defense, saving innocents at cost of self)
- "Plague Doctor" (highly educated scientists/healers, values alchemy, analyzing infections, cold rationalism, solving mysteries)
- "Bloodhound Ranger" (beastmasters/trackers, values raw wilderness instincts, treating beasts with dignity, self-reliance, simple truths)
- "Cursed Spellblade" (melee combatants bound by forbidden demonic blood pacts, values raw power, high risk high reward, anti-establishment rebellion)

Make sure companions chime in during story dialogues, offer their talents, or influence the story text (e.g., "Aethelgard advises against..."). Offer choices that utilize a companion's unique abilities when they are active in the party!

Dynamic Difficulty:
Track the user's success or failure. If they are struggling frequently, make the upcoming plot slightly easier or offer hints. If they are succeeding easily, introduce tougher obstacles.
Output "suggestedDifficultyAdjustment" as an integer: -1 (make easier), 0 (neutral), or 1 (make harder).

For the imagePrompt, provide a highly detailed, descriptive prompt for an image generator. Always include the art style: "dark fantasy digital painting, highly detailed, moody lighting, consistent character design".
Return the response strictly in JSON format matching the schema.`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    storyText: { type: Type.STRING, description: "The narrative text for the current step." },
    choices: { type: Type.ARRAY, items: { type: Type.STRING }, description: "2 to 4 choices for the user's next action." },
    inventory: { type: Type.ARRAY, items: { type: Type.STRING }, description: "The user's current inventory items." },
    quest: { type: Type.STRING, description: "The user's current active quest or objective." },
    imagePrompt: { type: Type.STRING, description: "Prompt for the image generator. Must include the consistent art style." },
    suggestedDifficultyAdjustment: { type: Type.NUMBER, description: "Suggested difficulty adjustment: -1, 0, or 1." },
    newLoreEntries: { type: Type.ARRAY, items: { type: Type.STRING }, description: "New facts or discoveries to add to the persistent lore database." },
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          relationship: { type: Type.STRING },
          status: { type: Type.STRING }
        },
        required: ["name", "description", "relationship", "status"]
      },
      description: "The full updated list of general characters encountered."
    },
    companions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          archetype: { type: Type.STRING },
          background: { type: Type.STRING },
          abilities: { type: Type.ARRAY, items: { type: Type.STRING } },
          loyalty: { type: Type.INTEGER },
          relationshipStatus: { type: Type.STRING },
          status: { type: Type.STRING }
        },
        required: ["name", "archetype", "background", "abilities", "loyalty", "relationshipStatus", "status"]
      },
      description: "List of recruited companion allies. Actively manage this based on user choices and companion reactions."
    },
    combatHistory: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          outcome: { type: Type.STRING },
          damageDealt: { type: Type.STRING },
          tacticsUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
          timeStamp: { type: Type.STRING }
        },
        required: ["outcome", "damageDealt", "tacticsUsed", "timeStamp"]
      },
      description: "Recent combat history entries."
    }
  },
  required: ["storyText", "choices", "inventory", "quest", "imagePrompt", "suggestedDifficultyAdjustment", "newLoreEntries", "characters", "companions", "combatHistory"]
};

// API Endpoints
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/story/step", async (req, res) => {
  try {
    const { history = [], userChoice = "", currentState } = req.body;
    const ai = getGenAI();

    let promptText = userChoice;
    if (currentState) {
      const companionsStr = currentState.companions?.map((c: Companion) =>
        `- ${c.name} (${c.archetype}): ${c.background}. Abilities: ${c.abilities.join(', ')}. Loyalty: ${c.loyalty}/100 [${c.relationshipStatus}]. Status: ${c.status}`
      ).join('\n') || 'No companions in the party.';

      promptText = `Current Inventory: ${currentState.inventory?.join(', ') || 'Empty'}
Current Quest: ${currentState.quest || 'None'}
Difficulty Level: ${currentState.difficultyLevel ?? 0}
Existing Lore:
${currentState.lore?.map((l: string) => `- ${l}`).join('\n') || 'No lore discovered yet.'}
Key Characters:
${currentState.characters?.map((c: Character) => `- ${c.name}: ${c.description} (Relationship: ${c.relationship}, Status: ${c.status})`).join('\n') || 'No key characters encountered yet.'}
Current Companions:
${companionsStr}
Combat History:
${currentState.combatHistory?.map((c: CombatEntry) => `- ${c.outcome} | Damage: ${c.damageDealt} | Tactics: ${c.tacticsUsed.join(', ')} (${c.timeStamp})`).join('\n') || 'No recent combat.'}
User Choice: ${userChoice}`;
    } else {
      promptText = `Start a new adventure. The user has no items, no quest and no companions yet. Introduce the world and give them a starting scenario. Make sure to present a chance or hinting at encountering dynamic companions of one of the defined archetypes early on.`;
    }

    const newHistory = [...history, { role: 'user', parts: [{ text: promptText }] }];

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: newHistory,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.7,
      }
    });

    const text = response.text || "{}";
    let cleanText = text.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const rawData = JSON.parse(cleanText);
    const state: GameState = rawData as GameState;

    const prevLore = currentState?.lore || [];
    const newLore = rawData.newLoreEntries || [];
    state.lore = [...prevLore, ...newLore];

    const prevDifficulty = currentState?.difficultyLevel ?? 0;
    const adjustment = Number(rawData.suggestedDifficultyAdjustment) || 0;
    state.difficultyLevel = Math.max(-2, Math.min(2, prevDifficulty + adjustment));

    res.json({
      state,
      newHistory: [...newHistory, { role: 'model', parts: [{ text }] }]
    });
  } catch (error: any) {
    console.error("Story step generation failed:", error);
    res.status(500).json({ error: error.message || "Failed to generate story step." });
  }
});

app.post("/api/image/generate", async (req, res) => {
  try {
    const { prompt, size = "1K" } = req.body;
    const ai = getGenAI();

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image",
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: size as "1K" | "2K" | "4K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return res.json({
          imageUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
        });
      }
    }

    res.status(500).json({ error: "No image generated" });
  } catch (error: any) {
    console.error("Image generation failed:", error);
    res.status(500).json({ error: error.message || "Failed to generate image." });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { chatHistory = [], message, model = 'gemini-3.7-flash', gameState } = req.body;
    const ai = getGenAI();

    const selectedModel = model === 'gemini-flash-lite-latest' || model === 'gemini-3.1-flash-lite'
      ? 'gemini-3.1-flash-lite'
      : 'gemini-3.7-flash';

    const systemInstruction = `You are a helpful Oracle in a dark fantasy text adventure game.
You can answer the user's questions about the world, their current quest, characters, companions, or give hints.
Current Game State:
Quest: ${gameState?.quest || 'None'}
Inventory: ${gameState?.inventory?.join(', ') || 'Empty'}
World Lore:
${gameState?.lore?.map((l: string) => `- ${l}`).join('\n') || 'No lore discovered yet.'}
Key Characters:
${gameState?.characters?.map((c: Character) => `- ${c.name}: ${c.description} (Relationship: ${c.relationship}, Status: ${c.status})`).join('\n') || 'None encountered.'}
Companions:
${gameState?.companions?.map((c: Companion) => `- ${c.name} (${c.archetype}): ${c.background} [Loyalty: ${c.loyalty}/100, Relation: ${c.relationshipStatus}, Status: ${c.status}]. Abilities: ${c.abilities?.join(', ')}`).join('\n') || 'None in party.'}
Combat History:
${gameState?.combatHistory?.map((c: CombatEntry) => `- ${c.outcome} | Damage: ${c.damageDealt} | Tactics: ${c.tacticsUsed.join(', ')} (${c.timeStamp})`).join('\n') || 'No recent combat.'}
Recent Story: ${gameState?.storyText || 'Just starting.'}
Keep responses concise and in character.`;

    const newHistory = [...chatHistory, { role: 'user', parts: [{ text: message }] }];

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: newHistory,
      config: {
        systemInstruction,
        temperature: 0.7,
      }
    });

    res.json({
      text: response.text || "",
      newHistory: [...newHistory, { role: 'model', parts: [{ text: response.text || "" }] }]
    });
  } catch (error: any) {
    console.error("Chat generation failed:", error);
    res.status(500).json({ error: error.message || "Failed to generate chat response." });
  }
});

// Setup Vite or Static File Serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
