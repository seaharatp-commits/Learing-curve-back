import { IsNumber, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class SendMessageDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  knowledgeBaseArticleId?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  knowledgeBaseConfidenceScore?: number;

  @IsString()
  @MinLength(1)
  content!: string;
}
