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

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>("AI_API_URL") ?? "http://localhost:3009";
    this.provider = this.configService.get<string>("AI_API_PROVIDER") || undefined;
    this.model = this.configService.get<string>("AI_API_MODEL") || undefined;
  }

  async chat(messages: AiChatMessage[], options: AiChatOptions = {}): Promise<string> {
    const { data } = await axios.post<AiChatResponse>(
      `${this.baseUrl}/chat`,
      {
        ...(this.provider ? { provider: this.provider } : {}),
        ...(this.model ? { model: this.model } : {}),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 512,
        messages,
      },
      { timeout: 30_000 },
    );

    if (!data.success) {
      throw new Error(data.error);
    }

    this.logger.log(
      `AI reply from ${data.data.provider}/${data.data.model} in ${data.data.latency_ms}ms`,
    );
    return data.data.content;
  }
}
