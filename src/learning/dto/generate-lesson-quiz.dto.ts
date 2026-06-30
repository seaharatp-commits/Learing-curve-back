import { IsOptional, IsString, MaxLength } from "class-validator";

export class GenerateLessonQuizDto {
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  additionalPrompt?: string;
}
