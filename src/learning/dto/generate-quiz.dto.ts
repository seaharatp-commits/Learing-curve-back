import { IsString, MinLength } from "class-validator";

export class GenerateQuizDto {
  @IsString()
  @MinLength(1)
  articleId!: string;
}
