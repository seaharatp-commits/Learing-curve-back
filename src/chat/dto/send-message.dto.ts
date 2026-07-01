import { IsOptional, IsString, MinLength } from "class-validator";

export class SendMessageDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  knowledgeBaseArticleId?: string;

  @IsString()
  @MinLength(1)
  content!: string;
}
