import { IsOptional, IsString, MaxLength } from "class-validator";

export class GenerateLessonQuizDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  additionalPrompt?: string;
}
