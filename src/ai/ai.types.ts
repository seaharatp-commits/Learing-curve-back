export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface AiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AiResponseData {
  provider: string;
  model: string;
  content: string;
  usage?: AiUsage;
  latency_ms: number;
}

export interface AiChatSuccessResponse {
  success: true;
  data: AiResponseData;
}

export interface AiChatErrorResponse {
  success: false;
  error: string;
}

export type AiChatResponse = AiChatSuccessResponse | AiChatErrorResponse;
