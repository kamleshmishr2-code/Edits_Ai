import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

const app = express();

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY is missing.");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

app.use(cors({
  origin: true,
  methods: ["POST", "GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({
  limit: "100kb"
}));

app.get("/", (req, res) => {
  res.json({
    name: "AI Edit Studio Backend",
    status: "online"
  });
});

app.post("/generate-plan", async (req, res) => {

  try {

    const {
      prompt = "",
      style = "cinematic",
      duration = 30,
      media = [],
      music = null
    } = req.body || {};

    if (!Array.isArray(media) || media.length === 0) {
      return res.status(400).json({
        error: "No media supplied."
      });
    }

    if (![15, 30, 45, 60].includes(Number(duration))) {
      return res.status(400).json({
        error: "Invalid duration."
      });
    }

    if (media.length > 100) {
      return res.status(400).json({
        error: "Too many media files."
      });
    }

    const cleanMedia = media.map((item, index) => ({
      index,
      name: String(item.name || `media_${index}`),
      type: String(item.type || "unknown"),
      duration:
        typeof item.duration === "number"
          ? item.duration
          : null
    }));

    const schema = {
      type: "object",
      properties: {
        version: {
          type: "integer"
        },
        aspectRatio: {
          type: "string"
        },
        duration: {
          type: "number"
        },
        style: {
          type: "string"
        },
        clips: {
          type: "array",
          items: {
            type: "object",
            properties: {
              mediaIndex: {
                type: "integer"
              },
              start: {
                type: "number"
              },
              duration: {
                type: "number"
              },
              effect: {
                type: "string"
              },
              transition: {
                type: "string"
              },
              speed: {
                type: "number"
              },
              crop: {
                type: "string"
              }
            },
            required: [
              "mediaIndex",
              "start",
              "duration",
              "effect",
              "transition",
              "speed",
              "crop"
            ]
          }
        },
        music: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean"
            },
            volume: {
              type: "number"
            },
            startAt: {
              type: "number"
            }
          },
          required: [
            "enabled",
            "volume",
            "startAt"
          ]
        },
        text: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string"
              },
              start: {
                type: "number"
              },
              duration: {
                type: "number"
              }
            },
            required: [
              "content",
              "start",
              "duration"
            ]
          }
        },
        color: {
          type: "object",
          properties: {
            filter: {
              type: "string"
            }
          },
          required: ["filter"]
        }
      },
      required: [
        "version",
        "aspectRatio",
        "duration",
        "style",
        "clips",
        "music",
        "text",
        "color"
      ]
    };

    const systemInstruction = `
You are the AI editing planner for AI Edit Studio.

You DO NOT render video.

You ONLY create a deterministic Edit Plan JSON.

The renderer will execute your plan.

Rules:

- aspectRatio must be exactly "9:16"
- version must be 1
- duration must equal the requested duration
- mediaIndex must refer only to supplied media
- never invent media files
- clips must fit inside the total duration
- use motion effects for photos
- use appropriate crop modes
- suggest transitions
- suggest speed changes for videos when useful
- text must be simple and timed
- music must only be enabled when music exists
- do not include explanations
- return ONLY JSON matching the supplied schema
`;

    const userPrompt = `
Requested style:
${style}

Requested duration:
${duration} seconds

User editing prompt:
${prompt || "Create a polished short-form video."}

Available media:
${JSON.stringify(cleanMedia, null, 2)}

Music:
${JSON.stringify(music, null, 2)}

Create the best deterministic edit plan.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.2
      }
    });

    const raw = response.text;

    if (!raw) {
      throw new Error("Gemini returned an empty response.");
    }

    let plan;

    try {
      plan = JSON.parse(raw);
    } catch {
      throw new Error("Gemini returned invalid JSON.");
    }

    validatePlan(plan, cleanMedia.length, Number(duration));

    return res.json(plan);

  } catch (error) {

    console.error("Generate plan error:", error);

    return res.status(500).json({
      error: "Unable to generate edit plan."
    });
  }
});

function validatePlan(plan, mediaCount, requestedDuration) {

  if (!plan || typeof plan !== "object") {
    throw new Error("Invalid plan.");
  }

  if (plan.version !== 1) {
    throw new Error("Invalid plan version.");
  }

  if (plan.aspectRatio !== "9:16") {
    throw new Error("Invalid aspect ratio.");
  }

  if (Number(plan.duration) !== requestedDuration) {
    throw new Error("Invalid duration.");
  }

  if (!Array.isArray(plan.clips)) {
    throw new Error("Invalid clips.");
  }

  for (const clip of plan.clips) {

    if (
      !Number.isInteger(clip.mediaIndex) ||
      clip.mediaIndex < 0 ||
      clip.mediaIndex >= mediaCount
    ) {
      throw new Error("Invalid media index.");
    }

    if (
      typeof clip.start !== "number" ||
      typeof clip.duration !== "number" ||
      clip.start < 0 ||
      clip.duration <= 0
    ) {
      throw new Error("Invalid clip timing.");
    }

    if (
      clip.start + clip.duration >
      requestedDuration + 0.1
    ) {
      throw new Error("Clip exceeds video duration.");
    }
  }

  if (!plan.music || typeof plan.music !== "object") {
    throw new Error("Invalid music plan.");
  }

  if (!Array.isArray(plan.text)) {
    throw new Error("Invalid text plan.");
  }

  if (!plan.color || typeof plan.color !== "object") {
    throw new Error("Invalid color plan.");
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `AI Edit Studio backend running on port ${PORT}`
  );
});
