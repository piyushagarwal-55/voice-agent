import { z } from "zod";
import { loadEnv } from "@repo/shared";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  LIVEKIT_URL: z.string().min(1, "LIVEKIT_URL is required"),
  LIVEKIT_API_KEY: z.string().min(1, "LIVEKIT_API_KEY is required"),
  LIVEKIT_API_SECRET: z.string().min(1, "LIVEKIT_API_SECRET is required"),
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_LLM_MODEL: z.string().default("openai/gpt-oss-120b"),
  SARVAM_API_KEY: z.string().min(1, "SARVAM_API_KEY is required"),
  SARVAM_LANGUAGE: z.string().default("hi-IN"),
  SARVAM_MODE: z.string().default("transcribe"),
  SARVAM_TTS_MODEL: z.enum(["bulbul:v3", "bulbul:v2"]).default("bulbul:v3"),
  SARVAM_TTS_SPEAKER: z.string().default("ritu"),
  SARVAM_TTS_LANGUAGE: z.string().default("hi-IN"),
});

export const env = loadEnv(schema);
