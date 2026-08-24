import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import type { AiChatMessage, AiChatOptions, AiChatResponse } from "./ai.types";

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly baseUrl: string;
  private readonly provider?: string;
  private readonly model?: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (this.configService.get<string>("AI_API_URL") ?? "http://localhost:3009").replace(/\/+$/, "");
    this.provider = this.configService.get<string>("AI_API_PROVIDER") || undefined;
    this.model = this.configService.get<string>("AI_API_MODEL") || undefined;
    const configuredTimeout = Number(this.configService.get<string>("AI_API_TIMEOUT_MS") ?? 30_000);
    this.timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000
      ? Math.min(configuredTimeout, 120_000)
      : 30_000;
  }

  async chat(messages: AiChatMessage[], options: AiChatOptions = {}): Promise<string> {
    const startedAt = Date.now();
    try {
      const { data } = await axios.post<AiChatResponse>(
        `${this.baseUrl}/chat`,
        {
          ...(this.provider ? { provider: this.provider } : {}),
          ...(this.model ? { model: this.model } : {}),
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 512,
          messages,
        },
        { timeout: this.timeoutMs },
      );

      if (!data.success) {
        throw new Error(data.error || "AI API Center returned an error");
      }

      this.logger.log(
        `AI request completed provider=${data.data.provider} model=${data.data.model} ` +
        `latencyMs=${Date.now() - startedAt} gatewayLatencyMs=${data.data.latency_ms}`,
      );
      return data.data.content;
    } catch (error) {
      const status = axios.isAxiosError(error) && error.response?.status
        ? ` HTTP ${error.response.status}`
        : "";
      this.logger.warn(
        `AI API Center request failed${status} latencyMs=${Date.now() - startedAt}; caller fallback will be used`,
      );
      const normalizedError = new Error("AI API Center ไม่พร้อมใช้งานชั่วคราว") as Error & {
        response?: { status: number };
      };
      normalizedError.response = {
        // Preserve the gateway status so callers can keep returning 503 for
        // temporary failures instead of misclassifying them as bad input.
        status: axios.isAxiosError(error) && error.response?.status
          ? error.response.status
          : 503,
      };
      throw normalizedError;
    }
  }
}
