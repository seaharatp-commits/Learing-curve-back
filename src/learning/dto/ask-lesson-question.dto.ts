import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class AskLessonQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  chatHistory?: string;
}
